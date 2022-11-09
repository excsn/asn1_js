import { Reporter } from "./base/reporter.js";
import * as decodersExports from "./decoders/index.js";
import * as encodersExport from "./encoders/index.js";

export function define(name: string, body: any) {
  return new Entity(name, body);
}

export class Entity {

  decoders: Record<string, any> = {};
  encoders: Record<string, any> = {};

  constructor(public name: string, public body: any) {
    this.name = name;
    this.body = body;
  }

  _createNamed(base: any) {
    const name = this.name;
  
    class Generated extends base {
      constructor(entity: Entity) {
        super(entity, name);
      }
    }
  
    return new Generated(this);
  }
  
  _getDecoder(enc: string) {
    enc = enc || 'der';

    // Lazily create decoder
    if (!this.decoders.hasOwnProperty(enc)) {
      this.decoders[enc] = this._createNamed((decodersExports as any)[enc]);
    }

    return this.decoders[enc];
  }
  
  decode(data: any, enc: string, options?: any) {
    return this._getDecoder(enc).decode(data, options);
  }
  
  _getEncoder(enc: string) {
    enc = enc || 'der';

    // Lazily create encoder
    if (!this.encoders.hasOwnProperty(enc)) {
      this.encoders[enc] = this._createNamed((encodersExport as any)[enc]);
    }

    return this.encoders[enc];
  }
  
  encode(data: any, enc: string, /* internal */ reporter: Reporter) {
    return this._getEncoder(enc).encode(data, reporter);
  }  
}