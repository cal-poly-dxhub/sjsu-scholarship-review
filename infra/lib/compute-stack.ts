import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import type { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { BUCKET_PREFIXES } from './data-stack';
import type { EnvStackProps } from './env';

export interface ComputeStackProps extends EnvStackProps {
  readonly table: dynamodb.Table;
  readonly bucket: s3.Bucket;
  readonly api: apigwv2.HttpApi;
  /** The same JWT check the front door uses, so no route can be added without one. */
  readonly authorizer: HttpUserPoolAuthorizer;
}

/** The handler code. One asset for every function; the modules are small and shared. */
const CODE_ROOT = path.join(__dirname, '..', '..', 'lambdas');

// The sample Lambdas are kept for reference and are not deployed.
const CODE_EXCLUDE = [
  'parse-applications',
  'score-applications',
  'requirements',
  '**/__pycache__',
  '**/*.pyc',
];

/** One file per layer. Keeping them out of the code asset stops a code edit rebuilding a layer. */
const REQUIREMENTS_DIR = path.join(CODE_ROOT, 'requirements');

/**
 * The model both scoring workers call. A `us.` id is a cross-region inference profile, so a
 * call can land in any US region and the policy has to allow the model there as well as the
 * profile here.
 */
const MODEL_ID = 'us.anthropic.claude-sonnet-4-6';

/** The Lambdas: route handlers, the ingest worker, and the two scoring workers. */
export class ComputeStack extends Stack {
  private readonly props: ComputeStackProps;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);
    this.props = props;

    const versions = this.pythonFunction('RubricVersions', {
      name: 'rubric-versions',
      handler: 'handlers.rubric_versions.handler',
      description: "Lists a scholarship's published rubric versions, newest first.",
    });
    props.table.grantReadData(versions);
    this.route('RubricVersionsRoute', apigwv2.HttpMethod.GET, '/api/rubric-versions', versions);

    const parse = this.pythonFunction('RubricParse', {
      name: 'rubric-parse',
      handler: 'handlers.rubric_parse.handler',
      description: 'Parses a rubric file and hands back what it found. Writes nothing.',
      timeout: Duration.seconds(29),
    });
    this.route('RubricParseRoute', apigwv2.HttpMethod.POST, '/api/rubric-parse', parse);

    const publish = this.pythonFunction('RubricPublish', {
      name: 'rubric-publish',
      handler: 'handlers.rubric_publish.handler',
      description: 'Parses a rubric file, checks its weights, writes the next version.',
      // The API Gateway integration gives up at 29 seconds, so there is no point waiting longer.
      timeout: Duration.seconds(29),
    });
    props.table.grantReadWriteData(publish);
    this.route('RubricPublishRoute', apigwv2.HttpMethod.POST, '/api/rubric-versions', publish);

    // The only read that names no cohort, so it is the one a screen can start from.
    const cohorts = this.pythonFunction('Cohorts', {
      name: 'cohorts',
      handler: 'handlers.cohorts.handler',
      description: 'Every cohort that has been ingested, so nobody has to guess a slug.',
    });
    props.table.grantReadData(cohorts);
    this.route('CohortsRoute', apigwv2.HttpMethod.GET, '/api/cohorts', cohorts);

    // The two reads every screen uses. Read-only on the table, and neither touches the bucket.
    const cohort = this.pythonFunction('Cohort', {
      name: 'cohort',
      handler: 'handlers.cohort.handler',
      description: "One cohort's applications without their essays, and what it is doing.",
      // A few thousand applications is several Query pages, and the integration gives up at 29s.
      timeout: Duration.seconds(29),
      memorySize: 512,
    });
    props.table.grantReadData(cohort);
    this.route('CohortRoute', apigwv2.HttpMethod.GET, '/api/cohort', cohort);

    const ranked = this.pythonFunction('Ranked', {
      name: 'ranked',
      handler: 'handlers.ranked.handler',
      description: 'One page of a cohort ranking, read off the ranking index.',
    });
    props.table.grantReadData(ranked);
    this.route('RankedRoute', apigwv2.HttpMethod.GET, '/api/ranked', ranked);

    const detail = this.pythonFunction('Application', {
      name: 'application',
      handler: 'handlers.application.handler',
      description: 'One application with its answers and its newest score item.',
    });
    props.table.grantReadData(detail);
    this.route('ApplicationRoute', apigwv2.HttpMethod.GET, '/api/application', detail);

    const scores = this.pythonFunction('Scores', {
      name: 'scores',
      handler: 'handlers.scores.handler',
      description: 'The newest score items for up to a hundred applications, by exact key.',
    });
    props.table.grantReadData(scores);
    this.route('ScoresRoute', apigwv2.HttpMethod.POST, '/api/scores', scores);

    // One layer for both ingest workers. They read the same two formats through the same reader,
    // so a second copy of openpyxl would only be a second thing to keep in step.
    const workbooks = this.pythonLayer(
      'OpenpyxlLayer',
      'openpyxl.txt',
      'openpyxl, for reading workbooks.',
    );

    const ingest = this.pythonFunction('Ingest', {
      name: 'ingest',
      handler: 'workers.ingest.handler',
      description: 'Reads an uploaded export and writes its applications into the cohort.',
      // An export is a few thousand rows and every row is a read plus a write.
      timeout: Duration.minutes(10),
      memorySize: 1024,
      layers: [workbooks],
    });
    props.table.grantReadWriteData(ingest);
    props.bucket.grantRead(ingest, `${BUCKET_PREFIXES.uploads}*`);
    new events.Rule(this, 'UploadedExport', {
      ruleName: `${props.envName}-uploaded-export`,
      description: 'An export landing under uploads/ starts the ingest worker.',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: { name: [props.bucket.bucketName] },
          // One wildcard per format, each carrying the prefix. A list of matchers is an OR, so
          // splitting these into a prefix and two suffixes would also fire on a .csv anywhere
          // in the bucket — including the batch/ files the scoring worker writes.
          object: {
            key: [
              { wildcard: `${BUCKET_PREFIXES.uploads}*.xlsx` },
              { wildcard: `${BUCKET_PREFIXES.uploads}*.csv` },
            ],
          },
        },
      },
      targets: [new targets.LambdaFunction(ingest)],
    });

    // The only worker that both reads and writes the table off a file: it reads the cohort to
    // match each row's applicant, and writes the reviewers' scores and the gap.
    const reviewerIngest = this.pythonFunction('ReviewerIngest', {
      name: 'reviewer-ingest',
      handler: 'workers.reviewer_ingest.handler',
      description: "Reads an uploaded reviewer-score file into a cohort and works out each gap.",
      // A few thousand rows, each with a read behind it, plus a summary rebuilt at the end.
      timeout: Duration.minutes(10),
      memorySize: 1024,
      layers: [workbooks],
    });
    props.table.grantReadWriteData(reviewerIngest);
    props.bucket.grantRead(reviewerIngest, `${BUCKET_PREFIXES.reviewerScores}*`);
    new events.Rule(this, 'UploadedReviewerScores', {
      ruleName: `${props.envName}-uploaded-reviewer-scores`,
      description: 'A reviewer-score file landing under reviewer-scores/ starts its ingest worker.',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: { name: [props.bucket.bucketName] },
          // One wildcard per format, each carrying the prefix, for the same reason the export
          // rule does it that way: a list of matchers is an OR.
          object: {
            key: [
              { wildcard: `${BUCKET_PREFIXES.reviewerScores}*.xlsx` },
              { wildcard: `${BUCKET_PREFIXES.reviewerScores}*.csv` },
            ],
          },
        },
      },
      targets: [new targets.LambdaFunction(reviewerIngest)],
    });

    const flagged = this.pythonFunction('Flagged', {
      name: 'flagged',
      handler: 'handlers.flagged.handler',
      description: 'One page of the review queue, read off the gap index, widest gap first.',
    });
    props.table.grantReadData(flagged);
    this.route('FlaggedRoute', apigwv2.HttpMethod.GET, '/api/flagged', flagged);

    const agreement = this.pythonFunction('Agreement', {
      name: 'agreement',
      handler: 'handlers.agreement.handler',
      description: 'How far apart the model and the reviewers are, off the cohort summaries.',
    });
    // Write as well as read: a summary left behind by a run that died is rebuilt on the read
    // rather than shown as it was.
    props.table.grantReadWriteData(agreement);
    this.route('AgreementRoute', apigwv2.HttpMethod.GET, '/api/agreement', agreement);

    const uploadReport = this.pythonFunction('UploadReport', {
      name: 'upload-report',
      handler: 'handlers.upload_report.handler',
      description: 'What an ingest made of one uploaded file, by the key it was uploaded to.',
    });
    props.table.grantReadData(uploadReport);
    this.route('UploadReportRoute', apigwv2.HttpMethod.GET, '/api/upload-report', uploadReport);

    const onDemand = this.pythonFunction('ScoreOnDemand', {
      name: 'score-ondemand',
      handler: 'workers.score_ondemand.handler',
      description: 'Scores a cohort one application per model call.',
      // The worker stops claiming a minute before this, so the number is a ceiling on the run,
      // not on one item.
      timeout: Duration.minutes(15),
      memorySize: 512,
      environment: { MODEL_ID },
      // The worker raises when any item failed, and the run route invokes it asynchronously, so
      // Lambda's default two retries re-run the whole cohort twice over — a quarter of an hour
      // each time, scoring nothing new. A run that needs another go is a button on the dashboard.
      retryAttempts: 0,
    });
    props.table.grantReadWriteData(onDemand);
    onDemand.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: this.modelResources(),
      }),
    );

    const batchRole = this.batchServiceRole();
    const batch = this.pythonFunction('ScoreBatch', {
      name: 'score-batch',
      handler: 'workers.score_batch.handler',
      description: 'Submits a Bedrock batch job, and collects it when the job ends.',
      timeout: Duration.minutes(15),
      memorySize: 1024,
      environment: {
        MODEL_ID,
        BUCKET_NAME: props.bucket.bucketName,
        BATCH_ROLE_ARN: batchRole.roleArn,
      },
      // modelInvocationType on CreateModelInvocationJob is newer than the boto3 the runtime
      // ships, and without it the job would read its records as InvokeModel input.
      layers: [this.pythonLayer('Boto3Layer', 'boto3.txt', 'A boto3 that knows batch Converse.')],
    });
    props.table.grantReadWriteData(batch);
    props.bucket.grantReadWrite(batch, `${BUCKET_PREFIXES.batch}*`);
    batch.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:CreateModelInvocationJob', 'bedrock:GetModelInvocationJob'],
        resources: [`arn:aws:bedrock:${this.region}:${this.account}:model-invocation-job/*`],
      }),
    );
    batch.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: this.modelResources(),
      }),
    );
    // Handing the job its service role is a separate permission from creating the job.
    batch.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [batchRole.roleArn],
        conditions: { StringEquals: { 'iam:PassedToService': 'bedrock.amazonaws.com' } },
      }),
    );
    // Reading a quota is account-wide; there is no per-quota resource to narrow it to.
    batch.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['servicequotas:ListServiceQuotas'],
        resources: ['*'],
      }),
    );

    // No Bedrock policy: a recompute is arithmetic over scores already stored, so a model call
    // from here would be a bug, not a feature.
    const recompute = this.pythonFunction('Recompute', {
      name: 'recompute',
      handler: 'workers.recompute.handler',
      description: "Moves a cohort's totals to a version that changed weights only.",
      timeout: Duration.minutes(5),
      memorySize: 512,
    });
    props.table.grantReadWriteData(recompute);

    // The dashboard's two writes: a URL to upload an export to, and starting a run. Both are
    // last so the run route can name the workers it invokes.
    const upload = this.pythonFunction('Upload', {
      name: 'upload',
      handler: 'handlers.upload.handler',
      description: 'Hands out a URL for uploading one export or one reviewer-score file.',
      environment: { BUCKET_NAME: props.bucket.bucketName },
    });
    props.bucket.grantPut(upload, `${BUCKET_PREFIXES.uploads}*`);
    props.bucket.grantPut(upload, `${BUCKET_PREFIXES.reviewerScores}*`);
    this.route('UploadRoute', apigwv2.HttpMethod.POST, '/api/upload', upload);

    const run = this.pythonFunction('Run', {
      name: 'run',
      handler: 'handlers.run.handler',
      description: 'Starts a scoring run for one cohort and one rubric version.',
      // Counting the work is a filtered Query over the cohort, which is several pages.
      timeout: Duration.seconds(29),
      memorySize: 512,
      environment: {
        ONDEMAND_FUNCTION: onDemand.functionName,
        BATCH_FUNCTION: batch.functionName,
        RECOMPUTE_FUNCTION: recompute.functionName,
      },
    });
    props.table.grantReadData(run);
    onDemand.grantInvoke(run);
    batch.grantInvoke(run);
    recompute.grantInvoke(run);
    // The batch floor is the same account-wide quota read the batch worker makes.
    run.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['servicequotas:ListServiceQuotas'],
        resources: ['*'],
      }),
    );
    this.route('RunRoute', apigwv2.HttpMethod.POST, '/api/run', run);

    new events.Rule(this, 'BatchJobEnded', {
      ruleName: `${props.envName}-batch-job-ended`,
      description: 'A finished batch job starts the collector. Nothing polls.',
      eventPattern: {
        source: ['aws.bedrock'],
        detailType: ['Batch Inference Job State Change'],
        // Every state a job cannot leave. Without Expired and Stopped, items claimed by a job
        // that never ran would stay claimed until someone noticed.
        detail: { status: ['Completed', 'PartiallyCompleted', 'Failed', 'Stopped', 'Expired'] },
      },
      targets: [new targets.LambdaFunction(batch)],
    });
  }

  /** The role Bedrock itself uses for a batch job. It reaches `batch/` in this bucket, nothing else. */
  private batchServiceRole(): iam.Role {
    const role = new iam.Role(this, 'BatchServiceRole', {
      roleName: `${this.props.envName}-bedrock-batch`,
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: {
            'aws:SourceArn': `arn:aws:bedrock:${this.region}:${this.account}:model-invocation-job/*`,
          },
        },
      }),
      description: 'Lets a Bedrock batch job read its input and write its output.',
    });
    this.props.bucket.grantRead(role, `${BUCKET_PREFIXES.batch}*`);
    this.props.bucket.grantWrite(role, `${BUCKET_PREFIXES.batch}*`);
    return role;
  }

  /**
   * A layer from one file in `lambdas/requirements/`. Built without Docker: pip installs the
   * wheels straight into the layer. Everything installed this way is pure Python, so the
   * machine that builds the layer does not have to match Lambda.
   */
  private pythonLayer(id: string, file: string, description: string): lambda.LayerVersion {
    const requirements = path.join(REQUIREMENTS_DIR, file);
    return new lambda.LayerVersion(this, id, {
      layerVersionName: `${this.props.envName}-${path.parse(file).name}`,
      description,
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_13],
      removalPolicy: RemovalPolicy.DESTROY,
      code: lambda.Code.fromAsset(REQUIREMENTS_DIR, {
        bundling: {
          image: lambda.Runtime.PYTHON_3_13.bundlingImage,
          command: ['bash', '-c', `pip install -r ${file} -t /asset-output/python`],
          local: {
            tryBundle(outputDir: string): boolean {
              const pip = spawnSync(
                'python',
                ['-m', 'pip', 'install', '-r', requirements, '-t', path.join(outputDir, 'python')],
                { stdio: 'inherit' },
              );
              return pip.status === 0;
            },
          },
        },
      }),
    });
  }

  /**
   * One function per job, each with its own log group and its own policy. A rubric handler
   * gets the table and nothing else — no bucket, no Bedrock.
   */
  private pythonFunction(
    id: string,
    options: {
      name: string;
      handler: string;
      description: string;
      timeout?: Duration;
      memorySize?: number;
      layers?: lambda.ILayerVersion[];
      environment?: Record<string, string>;
      retryAttempts?: number;
    },
  ): lambda.Function {
    const logGroup = new logs.LogGroup(this, `${id}Logs`, {
      logGroupName: `/aws/lambda/${this.props.envName}-${options.name}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    return new lambda.Function(this, id, {
      functionName: `${this.props.envName}-${options.name}`,
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: options.handler,
      code: lambda.Code.fromAsset(CODE_ROOT, { exclude: CODE_EXCLUDE }),
      description: options.description,
      timeout: options.timeout ?? Duration.seconds(10),
      memorySize: options.memorySize ?? 256,
      environment: { TABLE_NAME: this.props.table.tableName, ...options.environment },
      layers: options.layers,
      retryAttempts: options.retryAttempts,
      logGroup,
    });
  }

  /** The inference profile and the foundation model behind it. Nothing else in Bedrock. */
  private modelResources(): string[] {
    const foundation = MODEL_ID.replace(/^us\./, '');
    return [
      `arn:aws:bedrock:*::foundation-model/${foundation}`,
      `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${MODEL_ID}`,
    ];
  }

  private route(
    id: string,
    method: apigwv2.HttpMethod,
    routePath: string,
    target: lambda.Function,
  ): void {
    new apigwv2.HttpRoute(this, id, {
      httpApi: this.props.api,
      routeKey: apigwv2.HttpRouteKey.with(routePath, method),
      integration: new HttpLambdaIntegration(`${id}Integration`, target),
      authorizer: this.props.authorizer,
    });
  }
}
