import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import type { EnvStackProps } from './env';

/** The bucket's prefixes. One definition, so a handler and a policy cannot disagree. */
export const BUCKET_PREFIXES = {
  /** Workbooks a person uploads from the dashboard. Ingest reads them. */
  uploads: 'uploads/',
  /** Bedrock batch job input and output. Only the batch worker touches it. */
  batch: 'batch/',
  /** Anything produced for people to download. */
  analytics: 'analytics/',
} as const;

/** The ranking index: a cohort's comparable totals, already in score order. */
export const RANK_INDEX_NAME = 'rank-by-total';

/** The stores that outlive every redeploy: the scholarship table and the environment bucket. */
export class DataStack extends Stack {
  readonly table: dynamodb.Table;
  readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: EnvStackProps) {
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
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}
