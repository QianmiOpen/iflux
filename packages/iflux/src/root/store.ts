import produce from 'immer';
import { EffectLang } from '../el';
import { QueryLang } from '../ql';
import { Store } from '../store';
import {
  IRootStoreProps,
  TActionRetFn,
  TPath,
  TRootActionHandler
} from '../types';
import { getPathVal, isArray, isFn, isStr } from '../util';

/**
 *  Root state container
 */
export class RootStore<T = any> {
  //是否开启debug状态
  public debug: boolean;
  // 记录各个设置namespace的页面store
  public zoneMapper: { [name: string]: Store };

  //当前的状态
  private _state: T;
  //当前的el
  private _el: Array<Function>;

  //当前的el和ql计算的缓存
  private _cache: { [key: number]: Array<any> };
  //当前的dispatch的actionHandler
  private _action: { [name: string]: TRootActionHandler };

  constructor(props: IRootStoreProps<T>) {
    const { state = {}, el = {}, action = {} } = props;

    this._cache = {};
    this.zoneMapper = {};

    this.debug = false;
    this._state = state as T;
    this._el = this._transformEl(el);
    this._action = this._reduceAction(action);
  }

  private _parseEL = (el: EffectLang) => {
    const cache = [] as Array<any>;
    const { name, handler, deps } = el.meta();

    for (let dep of deps) {
      cache.push(this.bigQuery(dep));
    }

    return () => {
      let isChanged = false;
      if (process.env.NODE_ENV !== 'production') {
        if (this.debug && name) {
          console.groupCollapsed(`EL(${name}): debug mode`);
        }
      }

      deps.forEach((dep, i) => {
        //debug log
        if (process.env.NODE_ENV !== 'production') {
          if (this.debug && name) {
            console.log(`deps-> ${dep instanceof QueryLang ? 'QL' : dep}`);
          }
        }

        const val = this.bigQuery(dep);
        if (val !== cache[i]) {
          //debug log
          if (process.env.NODE_ENV !== 'production') {
            if (this.debug && name) {
              console.log('val: changed(Y)');
            }
          }
          isChanged = true;
          cache[i] = val;
        } else {
          //debug log
          if (process.env.NODE_ENV !== 'production') {
            if (this.debug && name) {
              console.log('val: changed(N)');
            }
          }
        }
      });

      if (isChanged) {
        if (process.env.NODE_ENV !== 'production') {
          if (this.debug && name) {
            console.log('deps val was changed. trigger once');
            console.groupEnd();
          }
        }
        handler(...cache);
      } else {
        if (process.env.NODE_ENV !== 'production') {
          if (this.debug && name) {
            console.log('deps val was not changed.');
            console.groupEnd();
          }
        }
      }
    };
  };

  private _transformEl = (el: { [key: string]: EffectLang }) => {
    return Object.keys(el).map(k => {
      const val = el[k];
      return this._parseEL(val);
    });
  };

  private _computeEL = () => {
    for (let handle of this._el) {
      handle();
    }
  };

  private _reduceAction(actions: {
    [name: string]: TActionRetFn;
  }): { [name: string]: TRootActionHandler } {
    return Object.keys(actions).reduce((r, key) => {
      const action = actions[key];
      // 如果当前的值不是函数，提前返回
      // 主要在用parcel build的时候
      // import * as action from './action'
      // action 常常会带一个 _esModule: true
      if (!isFn(action)) {
        return r;
      }
      const { msg, handler } = action();
      r[msg] = handler;
      return r;
    }, {});
  }

  dispatch = (action: string, params?: any) => {
    //debug log
    if (process.env.NODE_ENV !== 'production') {
      if (this.debug) {
        console.groupCollapsed(`dispath:-> ${action}`);
        console.log('params->', params);
      }
    }

    const handler = this._action[action];
    if (!handler) {
      //debug
      if (process.env.NODE_ENV !== 'production') {
        if (this.debug) {
          console.warn(
            `Oops, Could not find any root action handler. Please check you action`
          );
        }
      }
      return;
    }

    //debug
    if (process.env.NODE_ENV !== 'production') {
      if (this.debug) {
        console.log(`Action(${action}) received`);
        console.groupEnd();
      }
    }

    handler(this, params);
  };

  dispatchGlobal = (msg: string, params?: any) => {
    if (process.env.NODE_ENV !== 'production') {
      if (this.debug) {
        console.log(`dispatch global msg -> ${msg}`);
        console.log('params->', params);
      }
    }

    //dispatch root
    const handler = this._action[msg];
    if (handler) {
      //debug log
      if (process.env.NODE_ENV !== 'production') {
        if (this.debug) {
          console.log(`Root: handle -> ${msg} `);
        }
      }

      handler(this, params);
    }

    for (let ns in this.zoneMapper) {
      if (this.zoneMapper.hasOwnProperty(ns)) {
        const store = this.zoneMapper[ns];
        const handler = store.getAction()[msg];

        if (handler) {
          //debug log
          if (process.env.NODE_ENV !== 'production') {
            if (this.debug) {
              console.log(`${ns}: handle -> ${msg} `);
            }
          }

          handler(store, params);
        }
      }
    }
  };

  getState() {
    return Object.freeze(this._state);
  }

  setState = (callback: (data: T) => void) => {
    const state = produce(this._state, callback as any);
    if (state !== this._state) {
      this._state = state as T;
      this._computeEL();

      //通知所有的relax告诉大家root的state更新拉
      //relax会根据注入的属性判断是不是需要更新
      for (let namespace in this.zoneMapper) {
        if (this.zoneMapper.hasOwnProperty(namespace)) {
          this.zoneMapper[namespace].notifyRelax();
        }
      }
    }
  };

  bigQuery = (query: TPath | QueryLang) => {
    if (isStr(query) || isArray(query)) {
      return getPathVal(this._state, query);
    } else if (query instanceof QueryLang) {
      let isChanged = false;
      const { id, deps, name, handler } = query.meta();

      //init cache
      this._cache[id] || (this._cache[id] = []);
      const len = deps.length;

      //debug log
      if (process.env.NODE_ENV !== 'production') {
        if (this.debug && name) {
          console.groupCollapsed(`BigQuery(${name}):|>`);
        }
      }

      //计算pathVal
      deps.forEach((dep, i) => {
        const val = this.bigQuery(dep);
        if (val !== this._cache[id][i]) {
          isChanged = true;
        }

        //debug log
        if (process.env.NODE_ENV !== 'production') {
          if (this.debug && name) {
            const name =
              dep instanceof QueryLang ? `QL(${dep.meta.name})` : dep;
            console.log('dep ->', name);
            console.log('val ->', val);
          }
        }

        this._cache[id][i] = val;
      });

      if (isChanged) {
        const depVal = this._cache[id].slice(0, len);
        const result = handler(...depVal);
        this._cache[id][len] = result;

        //debug log
        if (process.env.NODE_ENV !== 'production') {
          if (this.debug && name) {
            console.log(`result: isChanged->Y`);
            console.log('val->', result);
            console.groupEnd();
          }
        }

        return result;
      } else {
        //debug log
        if (process.env.NODE_ENV !== 'production') {
          if (this.debug && name) {
            console.log(`result: isChanged->N`);
            console.log('val->', this._cache[id][len]);
            console.groupEnd();
          }
        }

        return this._cache[id][len];
      }
    }
  };

  addZone(namespace: string, store: Store) {
    this.zoneMapper[namespace] = store;
  }

  removeZone(namespace: string) {
    delete this.zoneMapper[namespace];
  }

  //=====================debug===========================
  pprint() {
    if (process.env.NODE_ENV !== 'production') {
      const state = { root: this.getState() };
      for (let ns in this.zoneMapper) {
        if (this.zoneMapper.hasOwnProperty(ns)) {
          state[ns] = this.zoneMapper[ns].getState();
        }
      }

      console.log(JSON.stringify(state, null, 2));
    }
  }

  pprintAction() {
    if (process.env.NODE_ENV !== 'production') {
      console.log(JSON.stringify(Object.keys(this._action), null, 2));
    }
  }
}

export function createRootStore<T>(props: IRootStoreProps<T>) {
  return () => new RootStore<T>(props);
}
