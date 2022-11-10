import assert from "minimalistic-assert";

import { Entity } from "../api.js";
import { convertStringToNumberOrZero } from "../constants/index.js";

// Supported tags
export const tags = [
  'seq', 'seqof', 'set', 'setof', 'objid', 'bool',
  'gentime', 'utctime', 'null_', 'enum', 'int', 'objDesc',
  'bitstr', 'bmpstr', 'charstr', 'genstr', 'graphstr', 'ia5str', 'iso646str',
  'numstr', 'octstr', 'printstr', 't61str', 'unistr', 'utf8str', 'videostr'
] as const;

// Public methods list
export const methods = [
  'key', 'obj', 'use', 'optional', 'explicit', 'implicit', 'def', 'choice',
  'any', 'contains', ...tags,
] as const;

// Overrided methods list
export const overrided = [
  '_peekTag', '_decodeTag', '_use',
  '_decodeStr', '_decodeObjid', '_decodeTime',
  '_decodeNull', '_decodeInt', '_decodeBool', '_decodeList',

  '_encodeComposite', '_encodeStr', '_encodeObjid', '_encodeTime',
  '_encodeNull', '_encodeInt', '_encodeBool'
] as const;

export const stateProps: (keyof NodeState)[] = [
  'enc', 'parent', 'children', 'tag', 'args', 'reverseArgs', 'choice',
  'optional', 'any', 'obj', 'use', 'key', 'default', 'explicit',
  'implicit', 'contains'
];

export interface NodeState {
  name?: string;
  enc: string;
  parent: Node | null;
  children: any[];
  tag: any;
  args: any;
  reverseArgs: any;
  choice: any;
  optional: boolean;
  any: boolean;
  obj: boolean;
  use: any;
  useDecoder: any;
  key: any;
  default: any;
  explicit: any;
  implicit: any;
  contains: any;
  defaultBuffer: any;
}

export interface Node {
  // These are auto implemented in the ctor
  seq(..._args: any): this;
  seqof(..._args: any): this;
  set(..._args: any): this;
  setof(..._args: any): this;
  objid(..._args: any): this;
  bool(..._args: any): this;
  gentime(..._args: any): this;
  utctime(..._args: any): this;
  null_(..._args: any): this;
  enum(..._args: any): this;
  int(..._args: any): this;
  objDesc(..._args: any): this;
  bitstr(..._args: any): this;
  bmpstr(..._args: any): this;
  charstr(..._args: any): this;
  genstr(..._args: any): this;
  graphstr(..._args: any): this;
  ia5str(..._args: any): this;
  iso646str(..._args: any): this;
  numstr(..._args: any): this;
  octstr(..._args: any): this;
  printstr(..._args: any): this;
  t61str(..._args: any): this;
  unistr(..._args: any): this;
  utf8str(..._args: any): this;
  videostr(..._args: any): this;
}

export abstract class Node {

  _baseState: NodeState;

  constructor(enc: string, parent?: Node | null, name?: string) {

    const state: NodeState = {
      name,
      enc,
      parent: parent || null,
      children: null as any,
      tag: null,
      args: null,
      reverseArgs: null,
      choice: null,
      optional: false,
      any: false,
      obj: false,
      use: null,
      useDecoder: null,
      key: null,
      default: null,
      explicit: null,
      implicit: null,
      contains: null,
      defaultBuffer: undefined,
    };

    this._baseState = state;
    
    tags.forEach((tag) => {
      (this as any)[tag] = function _tagMethod() {
        const state = this._baseState;
        const args = Array.prototype.slice.call(arguments);
    
        assert(state.tag === null);
        state.tag = tag;
    
        this._useArgs(args);
    
        return this;
      };
    });

    // Should create new instance on each method
    if (!parent) {
      state.children = [];
      this._wrap();
    }
  }

  abstract clone(): any;

  _wrap() {
    const state = this._baseState;
    methods.forEach(function (this: any, method) {
      (this as any)[method] = function _wrappedMethod() {
        const clone = new this.constructor(this);
        state.children.push(clone);
        return clone[method].apply(clone, arguments);
      };
    }, this);
  }

  _init(body: Function) {
    const state = this._baseState;
  
    assert(state.parent === null);
    body.call(this);
  
    // Filter children
    state.children = state.children.filter((child) => {
      return child._baseState.parent === this;
    }, this);
    assert.equal(state.children.length, 1, 'Root node can have only one child');
  }

  _useArgs(args: any[]) {
    const state = this._baseState;
  
    // Filter children and args
    const children = args.filter((arg) => {
      return arg instanceof this.constructor;
    }, this);
    args = args.filter((arg) => {
      return !(arg instanceof this.constructor);
    }, this);
  
    if (children.length !== 0) {
      assert(state.children === null);
      state.children = children;
  
      // Replace parent to maintain backward link
      children.forEach((child) => {
        child._baseState.parent = this;
      }, this);
    }
    if (args.length !== 0) {
      assert(state.args === null);
      state.args = args;
      state.reverseArgs = args.map(function(arg) {
        if (typeof arg !== 'object' || arg.constructor !== Object) {
          return arg;
        }
  
        const res: any = {};

        //TODO: Wtf is this?
        Object.keys(arg).forEach(function(key: any) {
          
          const newKey = convertStringToNumberOrZero(key);

          const value = arg[newKey];
          res[value] = newKey;
        });
        return res;
      });
    }
  }
  
  use(item: any): this {
    assert(item);
    const state = this._baseState;
  
    assert(state.use === null);
    state.use = item;
  
    return this;
  }
  
  optional(): this {
    const state = this._baseState;
  
    state.optional = true;
  
    return this;
  }
  
  def(val: any): this {
    const state = this._baseState;
  
    assert(state['default'] === null);
    state['default'] = val;
    state.optional = true;
  
    return this;
  }
  
  explicit(num: any): this {
    const state = this._baseState;
  
    assert(state.explicit === null && state.implicit === null);
    state.explicit = num;
  
    return this;
  }
  
  implicit(num: any): this {
    const state = this._baseState;
  
    assert(state.explicit === null && state.implicit === null);
    state.implicit = num;
  
    return this;
  }
  
  obj(...args: any): this {
    const state = this._baseState;
  
    state.obj = true;
  
    if (args.length !== 0)
      this._useArgs(args);
  
    return this;
  }
  
  key(newKey: any): this {
    const state = this._baseState;
  
    assert(state.key === null);
    state.key = newKey;
  
    return this;
  }
  
  any(): this {
    const state = this._baseState;
  
    state.any = true;
  
    return this;
  }
  
  choice(obj: any): this {
    const state = this._baseState;
  
    assert(state.choice === null);
    state.choice = obj;
    this._useArgs(Object.values(obj));
  
    return this;
  }
  
  contains(item: any): this {
    const state = this._baseState;
  
    assert(state.use === null);
    state.contains = item;
  
    return this;
  }

  abstract _use(entity: Entity, obj: any): any;
  
  _getUse(entity: Entity, obj: any) {
  
    const state = this._baseState;
    // Create altered use decoder if implicit is set
    state.useDecoder = this._use(entity, obj);
    assert(state.useDecoder._baseState.parent === null);
    state.useDecoder = state.useDecoder._baseState.children[0];
    if (state.implicit !== state.useDecoder._baseState.implicit) {
      state.useDecoder = state.useDecoder.clone();
      state.useDecoder._baseState.implicit = state.implicit;
    }
    return state.useDecoder;
  }

  _isNumstr(str: string): boolean {
    return /^[0-9 ]*$/.test(str);
  }
  
  _isPrintstr(str: string): boolean {
    return /^[A-Za-z0-9 '()+,-./:=?]*$/.test(str);
  }
}
