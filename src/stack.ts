import { TerraformStack, TerraformOutput } from 'cdktf';
import { Construct } from 'constructs';
import { AwsProvider, S3Bucket, DataAwsIamPolicyDocument, S3BucketPolicy } from '../.gen/providers/aws';

export class Cf2Tf extends TerraformStack {
  constructor(scope: Construct, name: string, cfStackJson: string) {
    super(scope, name);

    const resources = JSON.parse(cfStackJson);

    //TODO: use serverless options pass  the region
    new AwsProvider(this, 'provider', {
      region: 'us-west-2',
    });

    let s3Bucket: S3Bucket | undefined;

    for (const key in resources) {
      if (Object.prototype.hasOwnProperty.call(resources, key)) {
        console.log(resources[key].type);

        if (resources[key].type === 'AWS::S3::Bucket') {
          const bucketProperties = resources[key].Properties;

          //如果是 AWS::S3::Bucket
          s3Bucket = new S3Bucket(this, key, {
            serverSideEncryptionConfiguration: [
              {
                rule: [
                  {
                    applyServerSideEncryptionByDefault: [
                      {
                        sseAlgorithm: bucketProperties.BucketEncryption[0].ServerSideEncryptionByDefault.SSEAlgorithm,
                      },
                    ],
                  },
                ],
              },
            ],
          });
        }
      }
    }

    for (const key in resources) {
      if (Object.prototype.hasOwnProperty.call(resources, key)) {
        console.log(resources[key].type);

        if (s3Bucket === undefined) {
          return;
        }

        if (resources[key].type === 'AWS::S3::BucketPolicy') {
          const policyProperties = resources[key].Properties;

          const statement = policyProperties.PolicyDocument.Statement[0];
          const condition = statement.Condition;
          //check condition keys
          const conditionKey = Object.keys(condition)[0];
          const conditionVariable = Object.keys(condition[conditionKey])[0];

          const s3Policy = new DataAwsIamPolicyDocument(this, 'serverlessDeploymentBucketPolicyDocument', {
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

          new S3BucketPolicy(this, 'serverlessDeploymentBucketPolicy', {
            bucket: s3Bucket.bucket ?? '',
            policy: s3Policy.json,
          });

          new TerraformOutput(this, 'serverlessBucketName', {
            value: s3Bucket.bucket,
          });
        }
      }
    }
  }
}
