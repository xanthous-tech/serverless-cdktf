import Serverless from 'serverless';
import { TerraformStack, TerraformOutput, TerraformResource } from 'cdktf';
import { Construct } from 'constructs';
import { AwsProvider, S3Bucket, DataAwsIamPolicyDocument, S3BucketPolicy } from '../.gen/providers/aws';

interface RefObject {
  Ref?: string;
}

export class Cf2Tf extends TerraformStack {
  public cfResources: any;
  public cfOutputs: any;

  public tfResources: {
    [key: string]: TerraformResource;
  };

  public tfOutputs: {
    [key: string]: TerraformOutput;
  };

  constructor(scope: Construct, name: string, public serverless: Serverless, cfTemplate: any) {
    super(scope, name);

    this.cfResources = cfTemplate.Resources;
    this.cfOutputs = cfTemplate.Outputs;
    this.tfResources = {};
    this.tfOutputs = {};

    new AwsProvider(this, 'provider', {
      region: serverless.service.provider.region,
      profile: (serverless.service.provider as any).profile,
    });

    this.convertCfResources();
    this.convertCfOutputs();
  }

  private convertCfOutputs(): void {
    for (const key in this.cfOutputs) {
      if (!Object.prototype.hasOwnProperty.call(this.cfOutputs, key)) {
        continue;
      }

      const cfOutput = this.cfOutputs[key];
      this.tfOutputs[key] = new TerraformOutput(this, key, {
        value: Cf2Tf.handleOutputRef(this, cfOutput.Value),
      });
    }
  }

  private convertCfResources(): void {
    for (const key in this.cfResources) {
      if (!Object.prototype.hasOwnProperty.call(this.cfResources, key)) {
        continue;
      }

      const cfResource = this.cfResources[key];
      this.tfResources[key] = Cf2Tf.convertCfResource(this, key, cfResource);
    }
  }

  public static convertCfResource(self: Cf2Tf, key: string, cfResource: any): TerraformResource {
    switch (cfResource.Type) {
      case 'AWS::S3::Bucket':
        return Cf2Tf.convertS3Bucket(self, key, cfResource);
      case 'AWS::S3::BucketPolicy':
        return Cf2Tf.convertS3BucketPolicy(self, key, cfResource);
      default:
        throw new Error(`unsupported type ${cfResource.Type}`);
    }
  }

  public static convertS3Bucket(self: Cf2Tf, key: string, cfTemplate: any): S3Bucket {
    console.log('converting s3 bucket', cfTemplate);
    const bucketProperties = cfTemplate.Properties;

    return new S3Bucket(self, key, {
      // TODO: this is not flexible enough to handle the BucketEncryption list
      serverSideEncryptionConfiguration: [
        {
          rule: [
            {
              applyServerSideEncryptionByDefault: [
                {
                  sseAlgorithm: bucketProperties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm,
                },
              ],
            },
          ],
        },
      ],
    });
  }

  public static convertS3BucketPolicy(self: Cf2Tf, key: string, cfTemplate: any): S3BucketPolicy {
    console.log('converting s3 bucket policy', cfTemplate);
    const policyProperties = cfTemplate.Properties;
    const bucketRef = policyProperties.Bucket as RefObject;
    const s3Bucket = Cf2Tf.handleRef<S3Bucket>(self, bucketRef);

    const statement = policyProperties.PolicyDocument.Statement[0];
    const condition = statement.Condition;
    //check condition keys
    const conditionKey = Object.keys(condition)[0];
    const conditionVariable = Object.keys(condition[conditionKey])[0];

    const s3Policy = new DataAwsIamPolicyDocument(self, `${key}Document`, {
      statement: [
        {
          actions: [statement.Action],
          effect: statement.Effect,
          principals: [
            {
              identifiers: [statement.Principal],
              type: 'AWS',
            },
          ],
          // TODO: handle Fn:Join
          resources: [`arn:aws:s3:::${s3Bucket.bucket}/*`],
          condition: [
            {
              test: conditionKey,
              variable: conditionVariable,
              values: [condition[conditionKey][conditionVariable].toString()],
            },
          ],
        },
      ],
    });

    return new S3BucketPolicy(self, key, {
      dependsOn: [s3Bucket],
      bucket: s3Bucket.bucket ?? '',
      policy: s3Policy.json,
    });
  }

  public static handleRef<T extends TerraformResource>(self: Cf2Tf, { Ref }: RefObject): T {
    if (!Ref) {
      // is not ref, need to process other things
      throw new Error('it is not a ref object');
    }

    if (!self.tfResources[Ref] && self.cfResources[Ref]) {
      self.tfResources[Ref] = Cf2Tf.convertCfResource(self, Ref, self.cfResources[Ref]);
    }

    return self.tfResources[Ref] as T;
  }

  public static handleOutputRef(self: Cf2Tf, { Ref }: RefObject): any {
    if (!Ref) {
      // is not ref, need to process other things
      throw new Error('it is not a ref object');
    }

    const tfResource = self.tfResources[Ref];

    if (!tfResource) {
      throw new Error('cannot find reference');
    }

    // handle each specific ref type

    if (tfResource instanceof S3Bucket) {
      return (tfResource as S3Bucket).bucket;
    }

    throw new Error('unimplemented ref type');
  }
}
