import path from 'path';
import { spawn } from 'child_process';
import fs from 'fs-extra';
import Serverless from 'serverless';

export async function createCdktfJson(serverless: Serverless): Promise<void> {
  // serverless.cli.log('removing cdktf.out');
  // await fs.remove(path.resolve(serverlessTmpDirPath, '.gen'));
  // await fs.remove(path.resolve(serverlessTmpDirPath, 'cdktf.out'));

  serverless.cli.log('writing cdktf.json');
  await fs.writeJson(
    path.resolve(process.cwd(), 'cdktf.json'),
    {
      codeMakerOutput: '.serverless/.gen',
      language: 'typescript',
      terraformProviders: ['aws@~> 2.0'],
    },
    {
      spaces: 2,
    },
  );
}

export async function runCdktfGet(serverless: Serverless): Promise<void> {
  serverless.cli.log('running cdktf get');
  return new Promise<void>((resolve, reject) => {
    const cdktfGet = spawn(`./node_modules/.bin/cdktf`, ['get'], {
      cwd: process.cwd(),
      stdio: 'inherit',
    });

    cdktfGet.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('process finished with error code ' + code));
      }
    });

    cdktfGet.on('error', (error) => {
      reject(error);
    });
  });
}

export async function runCdktfSynth(serverless: Serverless, stack: string): Promise<void> {
  serverless.cli.log(`running cdktf synth on ${stack}`);
  return new Promise<void>((resolve, reject) => {
    const cdktfGet = spawn(
      `./node_modules/.bin/cdktf`,
      ['synth', '-a', `"./node_modules/.bin/sls-cdktf -s ${stack}"`, '-o', `./.serverless/cdktf-${stack}`],
      {
        cwd: process.cwd(),
        stdio: 'inherit',
      },
    );

    cdktfGet.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('process finished with error code ' + code));
      }
    });

    cdktfGet.on('error', (error) => {
      reject(error);
    });
  });
}

export async function runCdktfDeploy(serverless: Serverless, stack: string): Promise<void> {
  serverless.cli.log(`running cdktf deploy on ${stack}`);
  return new Promise<void>((resolve, reject) => {
    const cdktfGet = spawn(
      `./node_modules/.bin/cdktf`,
      ['deploy', '-a', `"./node_modules/.bin/sls-cdktf -s ${stack}"`, '-o', `./.serverless/cdktf-${stack}`, '--auto-approve'],
      {
        cwd: process.cwd(),
        stdio: 'inherit',
      },
    );

    cdktfGet.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('process finished with error code ' + code));
      }
    });

    cdktfGet.on('error', (error) => {
      reject(error);
    });
  });
}
