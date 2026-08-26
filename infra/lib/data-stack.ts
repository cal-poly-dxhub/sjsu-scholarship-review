import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import type { EnvStackProps } from './env';

/** The bucket's prefixes. One definition, so a handler and a policy cannot disagree. */
export const BUCKET_PREFIXES = {
  /** Exports a person uploads from the dashboard. Ingest reads them. */
  uploads: 'uploads/',
  /** Bedrock batch job input and output. Only the batch worker touches it. */
  batch: 'batch/',
} as const;

/** The ranking index: a cohort's comparable totals, already in score order. */
export const RANK_INDEX_NAME = 'rank-by-total';

/** Where the dashboard runs while someone is developing it. */
const DEV_SERVER_ORIGIN = 'http://localhost:3000';

export interface DataStackProps extends EnvStackProps {
  /**
   * The site's own origin, e.g. `https://d111.cloudfront.net`. The bucket answers the upload
   * preflight for it and nothing else.
   */
  readonly siteOrigin: string;
}

/** The stores that outlive every redeploy: the scholarship table and the environment bucket. */
export class DataStack extends Stack {
  readonly table: dynamodb.Table;
  readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    // pk and sk are the one thing that cannot be changed once the table exists. What they
    // hold depends on the item, so they are named for their role and the prefix inside the
    // value says which kind of item it is.
    this.table = new dynamodb.Table(this, 'ScholarshipTable', {
      tableName: `${props.envName}-scholarship`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // rank_pk is written with a comparable total and removed when one is invalidated, so the
    // index is sparse: unscored, failed, and older-rubric-version applications are absent by
    // construction rather than by a filter someone has to remember.
    this.table.addGlobalSecondaryIndex({
      indexName: RANK_INDEX_NAME,
      partitionKey: { name: 'rank_pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'total_score', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      // The fields the ranked list shows. qa_pairs is most of an item's bytes and is not one.
      nonKeyAttributes: [
        'status',
        'rubric_version',
        'category_scores',
        'latest_scored_at',
        'academic_program',
        'academic_level',
        'major',
        'gpa',
      ],
    });

    this.bucket = new s3.Bucket(this, 'EnvironmentBucket', {
      bucketName: `${props.envName}-sjsu-scholarship-${this.account}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      // Uploads reach the ingest worker through EventBridge rather than a bucket notification.
      // A notification would have to hold the worker's ARN, which puts this stack downstream of
      // the one that reads from it and CloudFormation refuses the loop.
      eventBridgeEnabled: true,
      removalPolicy: RemovalPolicy.RETAIN,
      // The browser sends the workbook straight here with a presigned PUT, which is cross-origin,
      // and a PUT always preflights. Only the bucket can answer that OPTIONS, so without this
      // rule every upload fails before a byte moves. PUT alone: a presigned URL that leaks is
      // then no use for reading anything back out.
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: [props.siteOrigin, DEV_SERVER_ORIGIN],
          allowedHeaders: ['content-type'],
          exposedHeaders: ['ETag'],
          maxAge: 3600,
        },
      ],
      lifecycleRules: [
        // Bedrock copies each record's input into its output, so batch files hold two copies
        // of every essay. They are only needed while a run can still be looked into.
        {
          id: 'expire-batch-files',
          prefix: BUCKET_PREFIXES.batch,
          expiration: Duration.days(30),
          noncurrentVersionExpiration: Duration.days(7),
          abortIncompleteMultipartUploadAfter: Duration.days(7),
        },
      ],
    });
  }
}
