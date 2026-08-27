import type { App, StackProps } from 'aws-cdk-lib';

/** Props every stack in this app takes: the environment it belongs to. */
export interface EnvStackProps extends StackProps {
  /** Environment name, e.g. `dev`. Part of every resource name that has to be unique. */
  readonly envName: string;
}

/**
 * Reads the environment name from CDK context (`-c env=<name>`, default in `cdk.json`).
 * Throws rather than falling back, so a typo cannot deploy into the wrong environment.
 */
export function envNameFromContext(app: App): string {
  const value: unknown = app.node.tryGetContext('env');
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('No environment name. Pass -c env=<name> or set "env" in cdk.json context.');
  }
  return value.trim();
}
