import Serverless from 'serverless';
import { Hooks } from 'serverless/classes/Plugin';
import { createCdktfJson, runCdktfGet, runCdktfSynth, runCdktfDeploy } from './utils/cdktf';

interface PluginDefinition {
  pluginName: string;
}

class ServerlessCdktfPlugin {
  serverless: Serverless;
  options: Serverless.Options;
  hooks: Hooks;

  constructor(serverless: Serverless, options: Serverless.Options) {
    this.serverless = serverless;
    this.options = options;

    console.log(serverless);

    serverless.cli.log('overriding AWS provider hooks');
    const pluginHooks = serverless.pluginManager.hooks as any;
    pluginHooks['aws:deploy:deploy:createStack'] = pluginHooks['aws:deploy:deploy:createStack'].filter(
      (plugin: PluginDefinition) => plugin.pluginName !== 'AwsDeploy',
    );
    pluginHooks['aws:deploy:deploy:updateStack'] = pluginHooks['aws:deploy:deploy:updateStack'].filter(
      (plugin: PluginDefinition) => plugin.pluginName !== 'AwsDeploy',
    );
    // console.log(pluginHooks['aws:deploy:deploy:createStack']);
    // console.log(pluginHooks['aws:deploy:deploy:updateStack']);

    //Set noDeploy config
    this.options['noDeploy'] = true;
    // console.log(options);

    this.hooks = {
      'after:package:finalize': this.convertToTerraformStack.bind(this),
    };

    // this.hooks = {
    //   'after:deploy:deploy': this.readCloudformationInfoAndConvert.bind(this),
    // };
  }

  private async convertToTerraformStack(): Promise<void> {
    // const serverlessTmpDirPath = path.resolve(this.serverless.config.servicePath, '.serverless');
    // this.serverless.cli.log(`serverless temp dir is ${serverlessTmpDirPath}`);

    await createCdktfJson(this.serverless);
    await runCdktfGet(this.serverless);

    //change to `update-stack` when testing update Stack.
    await runCdktfSynth(this.serverless, 'create-stack');
    await runCdktfDeploy(this.serverless, 'create-stack');
  }
}

export = ServerlessCdktfPlugin;
