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

    this.serverless.cli.suppressLogIfPrintCommand(this.serverless.processedInput);
    this.serverless.pluginManager.validateCommand(this.serverless.processedInput.commands);
    this.serverless.variables.populateService(this.serverless.pluginManager.cliOptions).then(() => {
      this.serverless.service.mergeArrays();
      this.serverless.service.setFunctionNames(this.serverless.processedInput.options);
      this.serverless.service.validate();

      console.log(`--------variables---------`);
      console.log(this.serverless.variables);
      console.log(`--------options---------`);
      console.log(options);

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
    });
  }

  private async convertToTerraformStack(): Promise<void> {
    // const serverlessTmpDirPath = path.resolve(this.serverless.config.servicePath, '.serverless');
    // this.serverless.cli.log(`serverless temp dir is ${serverlessTmpDirPath}`);

    await createCdktfJson(this.serverless);
    await runCdktfGet(this.serverless);

    //change to `update-stack` when testing update Stack.
    await runCdktfSynth(this.serverless, 'update-stack');
    await runCdktfDeploy(this.serverless, 'update-stack');
  }
}

export = ServerlessCdktfPlugin;
