import { Stack } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { EnvStackProps } from './env';

/** The Lambdas: route handlers, the ingest worker, and the two scoring workers. */
export class ComputeStack extends Stack {
  constructor(scope: Construct, id: string, props: EnvStackProps) {
    super(scope, id, props);
  }
}
