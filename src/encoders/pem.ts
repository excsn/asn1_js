import { DEREncoder } from "./der.js";
import { Entity } from "../api.js";
import { Reporter } from "../base/reporter.js";

export class PEMEncoder extends DEREncoder {
  constructor(entity: Entity) {
    super(entity);
    this.enc = 'pem';
  }

  encode(data: any, options: any) {
    const buf = DEREncoder.prototype.encode.call(this, data, new Reporter);
  
    const p = buf.toString('base64');
    const out = [ '-----BEGIN ' + options.label + '-----' ];

    for (let i = 0; i < p.length; i += 64) {
      out.push(p.slice(i, i + 64));
    }

    out.push('-----END ' + options.label + '-----');

    return out.join('\n');
  }
}
