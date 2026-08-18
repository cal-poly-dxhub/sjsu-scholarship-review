#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { ComputeStack } from '../lib/compute-stack';
import { DataStack } from '../lib/data-stack';
import { EdgeStack } from '../lib/edge-stack';
import { envNameFromContext } from '../lib/env';

const app = new App();
const envName = envNameFromContext(app);

// Account and region come from the CLI profile, so nothing pins an account in the repo.
const base = {
  envName,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
};

// Stacks split by how long what is inside them lives, not by phase. DataStack outlives
// the others and carries RETAIN; the rest are replaceable.
new DataStack(app, `${envName}-DataStack`, base);
new EdgeStack(app, `${envName}-EdgeStack`, base);
new ComputeStack(app, `${envName}-ComputeStack`, base);

Tags.of(app).add('project', 'sjsu-scholarship-review');
Tags.of(app).add('environment', envName);
