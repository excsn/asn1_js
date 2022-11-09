import { Entity } from "../api.js";
import { DecoderBuffer, DecoderBufferSaveState, DecoderError } from "../base/buffer.js";
import { Node, NodeState, stateProps } from "../base/node.js";
import { ReporterError } from "../base/reporter.js";
import * as der from "../constants/der.js";
import { convertStringToNumberOrZero } from "../constants/index.js";

export class DERDecoder {

  enc: string;
  name: string;
  tree = new DERNode();

  constructor (public entity: Entity) {
    this.enc = 'der';
    this.name = entity.name;

    // Construct base tree
    this.tree._init(entity.body);
  }

  decode(data: any, options?: any) {
    if (!DecoderBuffer.isDecoderBuffer(data)) {
      data = new DecoderBuffer(data, options);
    }
  
    return this.tree._decode(data, options);
  }
}

// Tree methods

export class DERNode extends Node {
  constructor(parent?: Node) {
    super("der", parent);
  }
  
  _decode(input: DecoderBuffer, options: any) {
    const state = this._baseState;
  
    // Decode root node
    if (state.parent === null) {
      return input.wrapResult(state.children[0]._decode(input, options));
    }
  
    let result = state['default'];
    let present = true;
  
    let prevKey: any = null; //TODO: This is odd. Being passed into leaveKey the way it could be
    if (state.key !== null) {
      prevKey = input.enterKey(state.key);
    }

    // Check if tag is there
    if (state.optional) {
      let tag = null;
      if (state.explicit !== null)
        tag = state.explicit;
      else if (state.implicit !== null)
        tag = state.implicit;
      else if (state.tag !== null)
        tag = state.tag;
  
      if (tag === null && !state.any) {
        // Trial and Error
        const save = input.saveBuffer();
        try {
          if (state.choice === null)
            this._decodeGeneric(state.tag, input, options);
          else
            this._decodeChoice(input, options);
          present = true;
        } catch (e) {
          present = false;
        }
        input.restoreBuffer(save);
      } else {
        present = this._peekTag(input, tag, state.any);
  
        if (input.isError(present))
          return present;
      }
    }
  
    // Push object on stack
    let prevObj;
    if (state.obj && present)
      prevObj = input.enterObject();
  
    if (present) {
      // Unwrap explicit values
      if (state.explicit !== null) {
        const explicit = this._decodeTag(input, state.explicit);
        if (input.isError(explicit))
          return explicit;
        input = explicit;
      }
  
      const start = input.offset;
  
      // Unwrap implicit and normal values
      if (state.use === null && state.choice === null) {
        let save: DecoderBufferSaveState | undefined = undefined;

        if (state.any) {
          save = input.saveBuffer();
        }

        const body = this._decodeTag(
          input,
          state.implicit !== null ? state.implicit : state.tag,
          state.any
        );

        if (input.isError(body)) {
          return body;
        }

        if (state.any) {
          result = input.raw(save);
        } else {
          input = body;
        }
      }
  
      if (options && options.track && state.tag !== null) {
        options.track(input.path(), start, input.length, 'tagged');
      }

      if (options && options.track && state.tag !== null) {
        options.track(input.path(), input.offset, input.length, 'content');
      }
  
      // Select proper method for tag
      if (state.any) {
        // no-op
      } else if (state.choice === null) {
        result = this._decodeGeneric(state.tag, input, options);
      } else {
        result = this._decodeChoice(input, options);
      }
  
      if (input.isError(result))
        return result;
  
      // Decode children
      if (!state.any && state.choice === null && state.children !== null) {
        state.children.forEach(function decodeChildren(child) {
          // NOTE: We are ignoring errors here, to let parser continue with other
          // parts of encoded data
          child._decode(input, options);
        });
      }
  
      // Decode contained/encoded by schema, only in bit or octet strings
      if (state.contains && (state.tag === 'octstr' || state.tag === 'bitstr')) {
        const data = new DecoderBuffer(result);
        result = this._getUse(state.contains, input._reporterState.obj)
          ._decode(data, options);
      }
    }
  
    // Pop object
    if (state.obj && present)
      result = input.leaveObject(prevObj);
  
    // Set key
    if (state.key !== null && (result !== null || present === true)) {
      input.leaveKey(prevKey, state.key, result);
    } else if (prevKey !== null){
      input.exitKey(prevKey);
    }

    return result;
  }

  _decodeChoice(input: DecoderBuffer, options: any) {
    const state = this._baseState;
    let result = null;
    let match = false;
  
    Object.keys(state.choice).some(function(key) {
      const save = input.saveBuffer();
      const node = state.choice[key];
      try {
        const value = node._decode(input, options);
        if (input.isError(value))
          return false;
  
        result = { type: key, value: value };
        match = true;
      } catch (e) {
        input.restoreBuffer(save);
        return false;
      }
      return true;
    }, this);
  
    if (!match)
      return input.error('Choice not matched');
  
    return result;
  }

  _decodeGeneric(tag: string, input: DecoderBuffer, options?: any) {
    const state = this._baseState;
  
    if (tag === 'seq' || tag === 'set')
      return null;
    if (tag === 'seqof' || tag === 'setof')
      return this._decodeList(input, tag, state.args[0], options);
    else if (/str$/.test(tag))
      return this._decodeStr(input, tag);
    else if (tag === 'objid' && state.args)
      return this._decodeObjid(input, state.args[0], state.args[1]);
    else if (tag === 'objid')
      return this._decodeObjid(input);
    else if (tag === 'gentime' || tag === 'utctime')
      return this._decodeTime(input, tag);
    else if (tag === 'null_')
      return this._decodeNull();
    else if (tag === 'bool')
      return this._decodeBool(input);
    else if (tag === 'objDesc')
      return this._decodeStr(input, tag);
    else if (tag === 'int' || tag === 'enum')
      return this._decodeInt(input, state.args && state.args[0]);
  
    if (state.use !== null) {
      return this._getUse(state.use, input._reporterState.obj)
        ._decode(input, options);
    } else {
      return input.error('unknown tag: ' + tag);
    }
  }

  _peekTag(buffer: DecoderBuffer, tag: any, any?: any) {
    if (buffer.isEmpty()) {
      return false;
    }

    const state = buffer.saveBuffer();
    const decodedTagr = derDecodeTag(buffer, 'Failed to peek tag: "' + tag + '"');
    if (buffer.isError(decodedTagr)) {
      return decodedTagr;
    }

    const decodedTag = decodedTagr as DERDecodeTag;

    buffer.restoreBuffer(state);
  
    return decodedTag.tag === tag || decodedTag.tagStr === tag || (decodedTag.tagStr + 'of') === tag || any;
  }
  
  _decodeTag(buffer: DecoderBuffer, tag: any, any?: any) {
    const decodedTagr = derDecodeTag(buffer, 'Failed to decode tag of "' + tag + '"');

    if (buffer.isError(decodedTagr)) {
      return decodedTagr;
    }

    const decodedTag = decodedTagr as DERDecodeTag;
    let len = derDecodeLen(
      buffer,
      decodedTag.primitive,
      'Failed to get length of "' + tag + '"'
    );
  
    // Failure
    if (buffer.isError(len)){
      return len;
    }
  
    if (!any &&
        decodedTag.tag !== tag &&
        decodedTag.tagStr !== tag &&
        decodedTag.tagStr + 'of' !== tag) {
      return buffer.error('Failed to match tag: "' + tag + '"');
    }
  
    if (decodedTag.primitive || len !== null) {
      return buffer.skip(len as number, 'Failed to match body of: "' + tag + '"');
    }

    // Indefinite length... find END tag
    const state = buffer.saveBuffer();
    const res = this._skipUntilEnd(
      buffer,
      'Failed to skip indefinite length body: "' + tag + '"');
    
      if (buffer.isError(res)) {
      return res;
    }

    len = buffer.offset - state.offset;
    buffer.restoreBuffer(state);

    return buffer.skip(len, 'Failed to match body of: "' + tag + '"');
  }
  
  _skipUntilEnd(buffer: DecoderBuffer, fail?: DecoderError): any {
    for (;;) {
      const tagr = derDecodeTag(buffer, fail);
      if (buffer.isError(tagr)) {
        return tagr;
      }

      const tag = tagr as DERDecodeTag;
      const len = derDecodeLen(buffer, tag.primitive, fail);
      if (buffer.isError(len)) {
        return len;
      }
  
      let res;
      if (tag.primitive || len !== null) {
        res = buffer.skip(len as number);
      } else {
        res = this._skipUntilEnd(buffer, fail);
      }

      // Failure
      if (buffer.isError(res)) {
        return res;
      }
  
      if (tag.tagStr === 'end') {
        break;
      }
    }
  }
  
  _decodeList(buffer: DecoderBuffer, tag: string, decoder: Entity, options: any) {
    const result = [];
    while (!buffer.isEmpty()) {
      const possibleEnd = this._peekTag(buffer, 'end');
      if (buffer.isError(possibleEnd))
        return possibleEnd;
  
      const res = decoder.decode(buffer, 'der', options);
      if (buffer.isError(res) && possibleEnd)
        break;
      result.push(res);
    }
    return result;
  }
  
  _decodeStr(buffer: DecoderBuffer, tag: string) {
    if (tag === 'bitstr') {
      const unused = buffer.readUInt8();
      if (buffer.isError(unused))
        return unused;
      return { unused: unused, data: buffer.raw() };
    } else if (tag === 'bmpstr') {
      const raw = buffer.raw();
      if (raw.length % 2 === 1)
        return buffer.error('Decoding of string type: bmpstr length mismatch');
  
      let str = '';
      for (let i = 0; i < raw.length / 2; i++) {
        str += String.fromCharCode(raw.readUInt16BE(i * 2));
      }
      return str;
    } else if (tag === 'numstr') {
      const numstr = buffer.raw().toString('ascii');
      if (!this._isNumstr(numstr)) {
        return buffer.error('Decoding of string type: ' +
                            'numstr unsupported characters');
      }
      return numstr;
    } else if (tag === 'octstr') {
      return buffer.raw();
    } else if (tag === 'objDesc') {
      return buffer.raw();
    } else if (tag === 'printstr') {
      const printstr = buffer.raw().toString('ascii');
      if (!this._isPrintstr(printstr)) {
        return buffer.error('Decoding of string type: ' +
                            'printstr unsupported characters');
      }
      return printstr;
    } else if (/str$/.test(tag)) {
      return buffer.raw().toString();
    } else {
      return buffer.error('Decoding of string type: ' + tag + ' unsupported');
    }
  }
  
  _decodeObjid(buffer: DecoderBuffer, values?: Record<string, any>, relative?: boolean) {
    let result;
    const identifiers = [];
    let ident = 0;
    let subident = 0;
    while (!buffer.isEmpty()) {
      subident = buffer.readUInt8() as number;
      ident <<= 7;
      ident |= subident & 0x7f;
      if ((subident & 0x80) === 0) {
        identifiers.push(ident);
        ident = 0;
      }
    }

    if (subident & 0x80) {
      identifiers.push(ident);
    }
  
    const first = (identifiers[0] / 40) | 0;
    const second = identifiers[0] % 40;
  
    if (relative)
      result = identifiers;
    else
      result = [first, second].concat(identifiers.slice(1));
  
    if (values) {
      let tmp = values[result.join(' ')];
      if (tmp === undefined)
        tmp = values[result.join('.')];
      if (tmp !== undefined)
        result = tmp;
    }
  
    return result;
  }
  
  _decodeTime(buffer: DecoderBuffer, tag: string) {
    const str = buffer.raw().toString();
  
    let year;
    let mon;
    let day;
    let hour;
    let min;
    let sec;
    if (tag === 'gentime') {
      year = convertStringToNumberOrZero(str.slice(0, 4));
      mon = convertStringToNumberOrZero(str.slice(4, 6));
      day = convertStringToNumberOrZero(str.slice(6, 8));
      hour = convertStringToNumberOrZero(str.slice(8, 10));
      min = convertStringToNumberOrZero(str.slice(10, 12));
      sec = convertStringToNumberOrZero(str.slice(12, 14));
    } else if (tag === 'utctime') {
      year = convertStringToNumberOrZero(str.slice(0, 2));
      mon = convertStringToNumberOrZero(str.slice(2, 4));
      day = convertStringToNumberOrZero(str.slice(4, 6));
      hour = convertStringToNumberOrZero(str.slice(6, 8));
      min = convertStringToNumberOrZero(str.slice(8, 10));
      sec = convertStringToNumberOrZero(str.slice(10, 12));
      if (year < 70)
        year = 2000 + year;
      else
        year = 1900 + year;
    } else {
      return buffer.error('Decoding ' + tag + ' time is not supported yet');
    }
  
    return Date.UTC(year, mon - 1, day, hour, min, sec, 0);
  };
  
  _decodeNull() {
    return null;
  }
  
  _decodeBool(buffer: DecoderBuffer) {
    const res = buffer.readUInt8();
    if (buffer.isError(res))
      return res;
    else
      return res !== 0;
  }
  
  _decodeInt(buffer: DecoderBuffer, values: Record<string, any>) {
    // Bigint, return as it is (assume big endian)
    const raw = buffer.raw();
    let res = raw.readBigInt64BE();
  
    if (values)
      res = values[res.toString(10)] || res;
  
    return res;
  }
  
  _use(entity: Entity, obj: any) {
    if (typeof entity === 'function') {
      entity = (entity as Function)(obj);
    }

    return entity._getDecoder('der').tree;
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
}

// Utility methods
export interface DERDecodeTag {
  cls: any;
  primitive: any;
  tag: number;
  tagStr: string;
}

function derDecodeTag(buf: DecoderBuffer, fail?: DecoderError): number | DERDecodeTag | ReporterError {
  let tag = buf.readUInt8(fail);
  if (buf.isError(tag)) {
    return tag as ReporterError;
  }

  if(typeof tag !== "number") {
    throw new Error("decoded tag is not a number");
  }

  const cls = der.tagClass[tag >> 6];
  const primitive = (tag & 0x20) === 0;

  // Multi-octet tag - load
  if ((tag & 0x1f) === 0x1f) {
    let oct = tag;
    tag = 0;
    while ((oct & 0x80) === 0x80) {
      let noct = buf.readUInt8(fail);
      if (buf.isError(noct)) {
        return noct;
      }

      oct = noct as number;

      tag <<= 7;
      tag |= oct & 0x7f;
    }
  } else {
    tag &= 0x1f;
  }
  const tagStr = der.tag[tag];

  return {
    cls: cls,
    primitive: primitive,
    tag: tag,
    tagStr: tagStr
  };
}

function derDecodeLen(buf: DecoderBuffer, primitive: boolean, fail?: DecoderError): number | null | ReporterError {
  let len = buf.readUInt8(fail);
  if (buf.isError(len)) {
    return len;
  }

  if(typeof len !== "number") {
    throw new Error("decoded len is not a number");
  }

  // Indefinite form
  if (!primitive && len === 0x80)
    return null;

  // Definite form
  if ((len & 0x80) === 0) {
    // Short form
    return len;
  }

  // Long form
  const num = len & 0x7f;
  if (num > 4)
    return buf.error('length octect is too long');

  len = 0;
  for (let i = 0; i < num; i++) {
    len <<= 8;
    const j = buf.readUInt8(fail);

    if(typeof j !== "number") {
      throw new Error("decoded j is not a number");
    }

    if (buf.isError(j)) {
      return j;
    }

    len |= j;
  }

  return len;
}
