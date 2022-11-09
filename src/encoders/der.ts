import assert from "minimalistic-assert";

import { Entity } from "../api.js";
import { EncoderBuffer } from "../base/buffer.js";
import { Node, NodeState, stateProps } from "../base/node.js";
import { Reporter } from "../base/reporter.js";
import * as der from "../constants/der.js";

function two(num: number) {
  if (num < 10)
    return '0' + num;
  else
    return num;
}

export class DEREncoder {
  
  enc: string;
  name: string;
  tree = new DERNode();

  constructor (public entity: Entity) {
    this.enc = 'der';
    this.name = entity.name;

    // Construct base tree
    this.tree._init(entity.body);
  }
  
  encode(data: any, reporter: Reporter) {
    return this.tree._encode(data, reporter).join();
  }
}

// Tree methods

export class DERNode extends Node {

  reporter: Reporter = new Reporter();

  constructor(parent?: Node) {
    super("der", parent);
  }

  clone(): any {
    const state: NodeState = this._baseState;
    const cstate: NodeState = {} as any;

    stateProps.forEach(function(prop) {
      (cstate as any)[prop] = state[prop];
    });

    const res = new DERNode(this);
    
    return res;
  }

  _createEncoderBuffer(data: any, reporter: Reporter) {
    return new EncoderBuffer(data, reporter);
  }
  
  _encode(data: any, reporter: Reporter, parent?: DERNode) {
    const state = this._baseState;
    if (state['default'] !== null && state['default'] === data)
      return;
  
    const result = this._encodeValue(data, reporter, parent);
    if (result === undefined)
      return;
  
    if (this._skipDefault(result, reporter, parent))
      return;
  
    return result;
  }
  
  _encodeValue(data: any, reporter: Reporter, parent?: Node) {
    const state = this._baseState;
  
    // Decode root node
    if (state.parent === null)
      return state.children[0]._encode(data, reporter || new Reporter());
  
    let result = null;
  
    // Set reporter to share it with a child class
    this.reporter = reporter;
  
    // Check if data is there
    if (state.optional && data === undefined) {
      if (state['default'] !== null)
        data = state['default'];
      else
        return;
    }
  
    // Encode children first
    let content = null;
    let primitive = false;
    if (state.any) {
      // Anything that was given is translated to buffer
      result = this._createEncoderBuffer(data, reporter);
    } else if (state.choice) {
      result = this._encodeChoice(data, reporter);
    } else if (state.contains) {
      content = this._getUse(state.contains, parent)._encode(data, reporter);
      primitive = true;
    } else if (state.children) {
      content = state.children.map(function(child) {
        if (child._baseState.tag === 'null_')
          return child._encode(null, reporter, data);
  
        if (child._baseState.key === null)
          return reporter.error('Child should have a key');
        const prevKey = reporter.enterKey(child._baseState.key);
  
        if (typeof data !== 'object')
          return reporter.error('Child expected, but input is not object');
  
        const res = child._encode(data[child._baseState.key], reporter, data);
        reporter.leaveKey(prevKey);
  
        return res;
      }, this).filter(function(child) {
        return child;
      });
      content = this._createEncoderBuffer(content, reporter);
    } else {
      if (state.tag === 'seqof' || state.tag === 'setof') {
        // TODO(indutny): this should be thrown on DSL level
        if (!(state.args && state.args.length === 1))
          return reporter.error('Too many args for : ' + state.tag);
  
        if (!Array.isArray(data))
          return reporter.error('seqof/setof, but data is not Array');
  
        const child = this.clone();
        child._baseState.implicit = null;
        content = this._createEncoderBuffer(data.map((item) => {
          const state = this._baseState;
  
          return this._getUse(state.args[0], data)._encode(item, reporter);
        }, child), reporter);
      } else if (state.use !== null) {
        result = this._getUse(state.use, parent)._encode(data, reporter);
      } else {
        content = this._encodePrimitive(state.tag, data);
        primitive = true;
      }
    }
  
    // Encode data itself
    if (!state.any && state.choice === null) {
      const tag = state.implicit !== null ? state.implicit : state.tag;
      const cls = state.implicit === null ? 'universal' : 'context';
  
      if (tag === null) {
        if (state.use === null)
          reporter.error('Tag could be omitted only for .use()');
      } else {
        if (state.use === null)
          result = this._encodeComposite(tag, primitive, cls, content);
      }
    }
  
    // Wrap in explicit
    if (state.explicit !== null)
      result = this._encodeComposite(state.explicit, false, 'context', result);
  
    return result;
  }
  
  _encodeChoice(data: any, reporter: Reporter) {
    const state = this._baseState;
  
    const node = state.choice[data.type];
    if (!node) {
      assert(
        false,
        data.type + ' not found in ' +
              JSON.stringify(Object.keys(state.choice)));
    }
    return node._encode(data.value, reporter);
  }
  
  _encodePrimitive(tag: string, data: any) {
    const state = this._baseState;
  
    if (/str$/.test(tag))
      return this._encodeStr(data, tag);
    else if (tag === 'objid' && state.args)
      return this._encodeObjid(data, state.reverseArgs[0], state.args[1]);
    else if (tag === 'objid')
      return this._encodeObjid(data);
    else if (tag === 'gentime' || tag === 'utctime')
      return this._encodeTime(data, tag);
    else if (tag === 'null_')
      return this._encodeNull();
    else if (tag === 'int' || tag === 'enum')
      return this._encodeInt(data, state.args && state.reverseArgs[0]);
    else if (tag === 'bool')
      return this._encodeBool(data);
    else if (tag === 'objDesc')
      return this._encodeStr(data, tag);
    else
      throw new Error('Unsupported tag: ' + tag);
  }

  _encodeComposite(tag: any, primitive: any, cls: any, content: any) {
    const encodedTag = encodeTag(tag, primitive, cls, this.reporter);
  
    // Short form
    if (content.length < 0x80) {
      const header = Buffer.alloc(2);
      header[0] = encodedTag;
      header[1] = content.length;
      return this._createEncoderBuffer([ header, content ], this.reporter);
    }
  
    // Long form
    // Count octets required to store length
    let lenOctets = 1;
    for (let i = content.length; i >= 0x100; i >>= 8)
      lenOctets++;
  
    const header = Buffer.alloc(1 + 1 + lenOctets);
    header[0] = encodedTag;
    header[1] = 0x80 | lenOctets;
  
    for (let i = 1 + lenOctets, j = content.length; j > 0; i--, j >>= 8)
      header[i] = j & 0xff;
  
    return this._createEncoderBuffer([ header, content ], this.reporter);
  }
  
  _encodeStr(str: any, tag: string) {
    if (tag === 'bitstr') {
      return this._createEncoderBuffer([ str.unused | 0, str.data ], this.reporter);
    } else if (tag === 'bmpstr') {
      const buf = Buffer.alloc(str.length * 2);
      for (let i = 0; i < str.length; i++) {
        buf.writeUInt16BE(str.charCodeAt(i), i * 2);
      }
      return this._createEncoderBuffer(buf, this.reporter);
    } else if (tag === 'numstr') {
      if (!this._isNumstr(str)) {
        return this.reporter.error('Encoding of string type: numstr supports ' +
                                   'only digits and space');
      }
      return this._createEncoderBuffer(str, this.reporter);
    } else if (tag === 'printstr') {
      if (!this._isPrintstr(str)) {
        return this.reporter.error('Encoding of string type: printstr supports ' +
                                   'only latin upper and lower case letters, ' +
                                   'digits, space, apostrophe, left and rigth ' +
                                   'parenthesis, plus sign, comma, hyphen, ' +
                                   'dot, slash, colon, equal sign, ' +
                                   'question mark');
      }
      return this._createEncoderBuffer(str, this.reporter);
    } else if (/str$/.test(tag)) {
      return this._createEncoderBuffer(str, this.reporter);
    } else if (tag === 'objDesc') {
      return this._createEncoderBuffer(str, this.reporter);
    } else {
      return this.reporter.error('Encoding of string type: ' + tag +
                                 ' unsupported');
    }
  };
  
  _encodeObjid(id: any, values?: any, relative?: boolean) {
    if (typeof id === 'string') {
      if (!values)
        return this.reporter.error('string objid given, but no values map found');
      if (!values.hasOwnProperty(id))
        return this.reporter.error('objid not found in values map');
      id = values[id].split(/[\s.]+/g);
      for (let i = 0; i < id.length; i++)
        id[i] |= 0;
    } else if (Array.isArray(id)) {
      id = id.slice();
      for (let i = 0; i < id.length; i++)
        id[i] |= 0;
    }
  
    if (!Array.isArray(id)) {
      return this.reporter.error('objid() should be either array or string, ' +
                                 'got: ' + JSON.stringify(id));
    }
  
    if (!relative) {
      if (id[1] >= 40)
        return this.reporter.error('Second objid identifier OOB');
      id.splice(0, 2, id[0] * 40 + id[1]);
    }
  
    // Count number of octets
    let size = 0;
    for (let i = 0; i < id.length; i++) {
      let ident = id[i];
      for (size++; ident >= 0x80; ident >>= 7)
        size++;
    }
  
    const objid = Buffer.alloc(size);
    let offset = objid.length - 1;
    for (let i = id.length - 1; i >= 0; i--) {
      let ident = id[i];
      objid[offset--] = ident & 0x7f;
      while ((ident >>= 7) > 0)
        objid[offset--] = 0x80 | (ident & 0x7f);
    }
  
    return this._createEncoderBuffer(objid, this.reporter);
  }
  
  _encodeTime(time: number, tag: string) {
    let str;
    const date = new Date(time);
  
    if (tag === 'gentime') {
      str = [
        two(date.getUTCFullYear()),
        two(date.getUTCMonth() + 1),
        two(date.getUTCDate()),
        two(date.getUTCHours()),
        two(date.getUTCMinutes()),
        two(date.getUTCSeconds()),
        'Z'
      ].join('');
    } else if (tag === 'utctime') {
      str = [
        two(date.getUTCFullYear() % 100),
        two(date.getUTCMonth() + 1),
        two(date.getUTCDate()),
        two(date.getUTCHours()),
        two(date.getUTCMinutes()),
        two(date.getUTCSeconds()),
        'Z'
      ].join('');
    } else {
      this.reporter.error('Encoding ' + tag + ' time is not supported yet');
    }
  
    return this._encodeStr(str, 'octstr');
  }
  
  _encodeNull() {
    return this._createEncoderBuffer('', this.reporter);
  }
  
  _encodeInt(num: any, values: any) {
    if (typeof num === 'string') {
      if (!values)
        return this.reporter.error('String int or enum given, but no values map');
      if (!values.hasOwnProperty(num)) {
        return this.reporter.error('Values map doesn\'t contain: ' +
                                   JSON.stringify(num));
      }
      num = values[num];
    }
  
    // Bignum, assume big endian
    if (typeof num !== 'number' && !Buffer.isBuffer(num)) {
      const numArray = num.toArray();
      if (!num.sign && numArray[0] & 0x80) {
        numArray.unshift(0);
      }
      num = Buffer.from(numArray);
    }
  
    if (Buffer.isBuffer(num)) {
      let size = num.length;
      if (num.length === 0)
        size++;
  
      const out = Buffer.alloc(size);
      num.copy(out);
      if (num.length === 0)
        out[0] = 0;
      return this._createEncoderBuffer(out, this.reporter);
    }
  
    if (num < 0x80)
      return this._createEncoderBuffer(num, this.reporter);
  
    if (num < 0x100)
      return this._createEncoderBuffer([0, num], this.reporter);
  
    let size = 1;
    for (let i = num; i >= 0x100; i >>= 8)
      size++;
  
    const out = new Array(size);
    for (let i = out.length - 1; i >= 0; i--) {
      out[i] = num & 0xff;
      num >>= 8;
    }
    if(out[0] & 0x80) {
      out.unshift(0);
    }
  
    return this._createEncoderBuffer(Buffer.from(out), this.reporter);
  }
  
  _encodeBool(value: boolean) {
    return this._createEncoderBuffer(value ? 0xff : 0, this.reporter);
  }
  
  _use(entity: Entity | Function, obj: any) {

    if (typeof entity === 'function') {
      entity = entity(obj);
    }

    return (entity as Entity)._getEncoder('der').tree;
  }
  
  _skipDefault(dataBuffer: EncoderBuffer, reporter: Reporter, parent?: DERNode) {

    const state = this._baseState;
    let i;

    if (state['default'] === null) {
      return false;
    }
  
    const data = dataBuffer.join();
    if (state.defaultBuffer === undefined) {
      state.defaultBuffer = this._encodeValue(state['default'], reporter, parent).join();
    }
  
    if (data.length !== state.defaultBuffer.length)
      return false;
  
    for (i=0; i < data.length; i++) {
      if (data[i] !== state.defaultBuffer[i]) {
        return false;
      }
    }
  
    return true;
  }
}



// Utility methods

function encodeTag(tag: string, primitive: boolean, cls: string, reporter: Reporter) {
  let res;

  if (tag === 'seqof')
    tag = 'seq';
  else if (tag === 'setof')
    tag = 'set';

  if (der.tagByName.hasOwnProperty(tag))
    res = der.tagByName[tag];
  else if (typeof tag === 'number' && (tag | 0) === tag)
    res = tag;
  else
    return reporter.error('Unknown tag: ' + tag);

  if (res >= 0x1f)
    return reporter.error('Multi-octet tag encoding unsupported');

  if (!primitive)
    res |= 0x20;

  res |= (der.tagClassByName[cls || 'universal'] << 6);

  return res;
}
