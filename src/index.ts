import * as Serverless from 'serverless';
import { Hooks } from 'serverless/classes/Plugin';
import * as path from 'path';
import { convert } from './helper';

class ServerlessCdktfPlugin {
  serverless: Serverless;
  options: Serverless.Options;
  hooks: Hooks;

  constructor(serverless: Serverless, options: Serverless.Options) {
    this.serverless = serverless;
    this.options = options;

    console.log(serverless);

    //Set noDeploy config
    this.options['noDeploy'] = true;
    console.log(options);

    this.hooks = {
      'after:deploy:deploy': this.readCloudformationInfoAndConvert.bind(this),
    };
  }

  private readCloudformationInfoAndConvert(): void {
    const serverlessTmpDirPath = path.join(this.serverless.config.servicePath, '.serverless');
    this.serverless.cli.log(`serverless temp dir is ${serverlessTmpDirPath}`);

    //TODO: DO NOT USE hard coded create-stack.json.
    const app = convert(`${serverlessTmpDirPath}/cloudformation-template-create-stack.json`);
    app.synth();
  }
}

export default ServerlessCdktfPlugin;
