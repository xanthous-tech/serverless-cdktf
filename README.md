# serverless-cdktf

A [serverless](https://serverless.com) plugin that deploys AWS serverless stack via Terraform, using [CDKTF](https://github.com/hashicorp/terraform-cdk).

# Usage

```shell
yarn add serverless-cdktf --dev
```

just add the plugin into the `plugins` field in `serverless.yml` and it will do the rest.

# variables

the plugin looks for the following configuration values in `serverless.yml`'s `custom` section:

```yaml
custom:
  # accountId is more or less global, and we would need that to override the `AWS:AccountId` variable in CloudFormation
  accountId: "<aws_account_id>"
  # optional, this variable is only needed when you use a monorepo setup and the dependency is hoisted
  binPath: ../node_modules/.bin
  cdktf:
    deploymentBucketName: "<deployment_bucket_name>"
    s3Backend:
      region: "<s3_backend_region>"
      profile: "<s3_backend_aws_profile>" # optional, this looks for credential profile under ~/.aws/credentials, by default it uses the same profile defined in the serverless stack
      accessKey: "<s3_backend_aws_access_key>" # alternatively, provide the keys directly
      secretKey: "<s3_backend_aws_secret_key>"
      bucket: "<s3_backend_bucket_name>"
      key: "<s3_backend_key>"
    remoteState:
      region: "<remote_state_region>" # optional
      profile: "<remote_state_aws_profile>" # optional, this looks for credential profile under ~/.aws/credentials, by default it uses the same profile defined in the serverless stack
      accessKey: "<remote_state_aws_access_key>" # alternatively, provide the keys directly
      secretKey: "<remote_state_aws_secret_key>"
      bucket: "<remote_state_bucket_name>"
      key: "<remote_state_key>"
```

# Terraform and Provider Support

Currently we are developing using Terraform v0.12 and AWS Provider v2.70.0. Any other version combinations are likely to work, but it would require building this package yourself for now, since the CDK definitions are generated based on the versions you have at build time.

# Resources Supported

- [x] S3 Bucket
- [X] S3 Bucket Policy
- [X] Lambda Functions
- [X] IAM Roles and Policy Documents
- [X] API Gateway
- [X] CloudFront Distribution

# License

[MIT](./LICENSE).
