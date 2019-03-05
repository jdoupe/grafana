// Libraries
import _ from 'lodash';
import coreModule from 'app/core/core_module';

// Services & Utils
import config from 'app/core/config';
import { importPluginModule } from './plugin_loader';

// Types
import { DataSourceApi, DataSourceSelectItem } from '@grafana/ui/src/types';

export class DatasourceSrv {
  datasources: { [name: string]: DataSourceApi };

  /** @ngInject */
  constructor(private $q, private $injector, private $rootScope, private templateSrv) {
    this.init();
  }

  init() {
    this.datasources = {};
  }

  get(name?: string, scopedVars?: any): Promise<DataSourceApi> {
    if (!name) {
      return this.get(config.defaultDatasource);
    }
    const beforeName = name;
    name = this.templateSrv.replace(name);

    if (beforeName !== name) {
      // Means datasource contained a variable
      // look up beforeName in scopedVars (without the '$')
      const re1 = /\$(.*)+/;
      const newName = beforeName.replace(re1, '$1');
      // Make sure scopedVars is defined AND the variable is still active
      if (scopedVars && this.templateSrv.index[newName] && this.templateSrv.index[newName].type === 'datasource') {
        name = scopedVars[newName].value;
      } else {
        // if datasource provided as an array, just use the first one
        const re = /{([^,}]+).*/;
        name = name.replace(re, '$1');
      }
    }

    if (name === 'default') {
      return this.get(config.defaultDatasource);
    }

    if (this.datasources[name]) {
      return this.$q.when(this.datasources[name]);
    }

    return this.loadDatasource(name);
  }

  loadDatasource(name: string): Promise<DataSourceApi> {
    const dsConfig = config.datasources[name];
    if (!dsConfig) {
      return this.$q.reject({ message: 'Datasource named ' + name + ' was not found' });
    }

    const deferred = this.$q.defer();
    const pluginDef = dsConfig.meta;

    importPluginModule(pluginDef.module)
      .then(plugin => {
        // check if its in cache now
        if (this.datasources[name]) {
          deferred.resolve(this.datasources[name]);
          return;
        }

        // plugin module needs to export a constructor function named Datasource
        if (!plugin.Datasource) {
          throw new Error('Plugin module is missing Datasource constructor');
        }

        const instance: DataSourceApi = this.$injector.instantiate(plugin.Datasource, { instanceSettings: dsConfig });
        instance.meta = pluginDef;
        instance.name = name;
        instance.pluginExports = plugin;
        this.datasources[name] = instance;
        deferred.resolve(instance);
      })
      .catch(err => {
        this.$rootScope.appEvent('alert-error', [dsConfig.name + ' plugin failed', err.toString()]);
      });

    return deferred.promise;
  }

  getAll() {
    const { datasources } = config;
    return Object.keys(datasources).map(name => datasources[name]);
  }

  getExternal() {
    const datasources = this.getAll().filter(ds => !ds.meta.builtIn);
    return _.sortBy(datasources, ['name']);
  }

  getAnnotationSources() {
    const sources = [];

    this.addDataSourceVariables(sources);

    _.each(config.datasources, value => {
      if (value.meta && value.meta.annotations) {
        sources.push(value);
      }
    });

    return sources;
  }

  getMetricSources(options?) {
    const metricSources: DataSourceSelectItem[] = [];

    _.each(config.datasources, (value, key) => {
      if (value.meta && value.meta.metrics) {
        let metricSource = { value: key, name: key, meta: value.meta, sort: key };

        //Make sure grafana and mixed are sorted at the bottom
        if (value.meta.id === 'grafana') {
          metricSource.sort = String.fromCharCode(253);
        } else if (value.meta.id === 'mixed') {
          metricSource.sort = String.fromCharCode(254);
        }

        metricSources.push(metricSource);

        if (key === config.defaultDatasource) {
          metricSource = { value: null, name: 'default', meta: value.meta, sort: key };
          metricSources.push(metricSource);
        }
      }
    });

    if (!options || !options.skipVariables) {
      this.addDataSourceVariables(metricSources);
    }

    metricSources.sort((a, b) => {
      if (a.sort.toLowerCase() > b.sort.toLowerCase()) {
        return 1;
      }
      if (a.sort.toLowerCase() < b.sort.toLowerCase()) {
        return -1;
      }
      return 0;
    });

    return metricSources;
  }

  addDataSourceVariables(list) {
    // look for data source variables
    for (let i = 0; i < this.templateSrv.variables.length; i++) {
      const variable = this.templateSrv.variables[i];
      if (variable.type !== 'datasource') {
        continue;
      }

      let first = variable.current.value;
      if (first === 'default') {
        first = config.defaultDatasource;
      }

      const ds = config.datasources[first];

      if (ds) {
        const key = `$${variable.name}`;
        list.push({
          name: key,
          value: key,
          meta: ds.meta,
          sort: key,
        });
      }
    }
  }
}

let singleton: DatasourceSrv;

export function setDatasourceSrv(srv: DatasourceSrv) {
  singleton = srv;
}

export function getDatasourceSrv(): DatasourceSrv {
  return singleton;
}

coreModule.service('datasourceSrv', DatasourceSrv);
export default DatasourceSrv;
