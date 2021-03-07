'use strict';
/**
 * NPM packager.
 */

const _ = require('lodash');
const BbPromise = require('bluebird');
const Utils = require('../utils');

class PNPM {
  // eslint-disable-next-line lodash/prefer-constant
  static get lockfileName() {
    return 'pnpm-lock.yaml';
  }

  static get copyPackageSectionNames() {
    return [];
  }

  // eslint-disable-next-line lodash/prefer-constant
  static get mustCopyModules() {
    return true;
  }

  static getProdDependencies(cwd, depth, pkg) {
    // Get first level dependency graph
    const command = /^win/.test(process.platform) ? 'pnpm.cmd' : 'pnpm';
    const args = [
      'ls',
      '-r',
      '-prod', // Only prod dependencies
      '-json',
      `-depth=${depth || 1}`,
      `--filter=${pkg.name}...`
    ];

    const ignoredNpmErrors = [
      { npmError: 'extraneous', log: false },
      { npmError: 'missing', log: false },
      { npmError: 'peer dep missing', log: true }
    ];

    return (
      Utils.spawnProcess(command, args, {
        cwd: cwd
      })
        .catch(err => {
          if (err instanceof Utils.SpawnError) {
            // Only exit with an error if we have critical npm errors for 2nd level inside
            const errors = _.split(err.stderr, '\n');
            const failed = _.reduce(
              errors,
              (failed, error) => {
                if (failed) {
                  return true;
                }
                return (
                  !_.isEmpty(error) &&
                  !_.some(ignoredNpmErrors, ignoredError => _.startsWith(error, `npm ERR! ${ignoredError.npmError}`))
                );
              },
              false
            );

            if (!failed && !_.isEmpty(err.stdout)) {
              return BbPromise.resolve({ stdout: err.stdout });
            }
          }

          return BbPromise.reject(err);
        })
        .then(processOutput => processOutput.stdout)
        // pnpm version of ls returns an array
        .then(depJson =>
          BbPromise.try(() => {
            // pnpm uses a different format than npm/yarn for the `ls` output
            // for monorepos local dependencies need to be combined into the tree
            // of the project that is being deployed
            const allDependencies = _.keyBy(JSON.parse(depJson), dep => dep.name);
            const project = allDependencies[pkg.name];
            project.dependencies = _.reduce(
              project.dependencies,
              (acc, dep) => {
                //TODO - does pnpm have other formats where the full tree isn't expanded
                if (_.startsWith(dep.version, 'link')) {
                  if (allDependencies[dep.from]) acc.push(allDependencies[dep.from]);
                } else if (dep) {
                  acc.push(dep);
                }
                return acc;
              },
              []
            );
            project.dependencies = _.keyBy(project.dependencies, dep => dep.from || dep.name);
            return project;
          })
        )
    );
  }

  static _rebaseFileReferences(pathToPackageRoot, moduleVersion) {
    if (/^file:[^/]{2}/.test(moduleVersion)) {
      const filePath = _.replace(moduleVersion, /^file:/, '');
      return _.replace(`file:${pathToPackageRoot}/${filePath}`, /\\/g, '/');
    }

    return moduleVersion;
  }

  /**
   * We should not be modifying 'package-lock.json'
   * because this file should be treated as internal to npm.
   *
   * Rebase package-lock is a temporary workaround and must be
   * removed as soon as https://github.com/npm/npm/issues/19183 gets fixed.
   */
  static rebaseLockfile(pathToPackageRoot, lockfile) {
    if (lockfile.version) {
      lockfile.version = PNPM._rebaseFileReferences(pathToPackageRoot, lockfile.version);
    }

    if (lockfile.dependencies) {
      _.forIn(lockfile.dependencies, lockedDependency => {
        PNPM.rebaseLockfile(pathToPackageRoot, lockedDependency);
      });
    }

    return lockfile;
  }

  static install(cwd) {
    const command = /^win/.test(process.platform) ? 'npm.cmd' : 'npm';
    const args = ['install'];

    return Utils.spawnProcess(command, args, { cwd }).return();
  }

  static prune(cwd) {
    const command = /^win/.test(process.platform) ? 'npm.cmd' : 'npm';
    const args = ['prune'];

    return Utils.spawnProcess(command, args, { cwd }).return();
  }

  static runScripts(cwd, scriptNames) {
    const command = /^win/.test(process.platform) ? 'npm.cmd' : 'npm';
    return BbPromise.mapSeries(scriptNames, scriptName => {
      const args = [ 'run', scriptName ];

      return Utils.spawnProcess(command, args, { cwd });
    }).return();
  }
}

module.exports = PNPM;
