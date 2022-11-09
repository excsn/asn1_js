export interface ReporterState {
  obj: any;
  path: string[];
  options: any;
  errors: ReporterError[];
}

export interface ReporterSaveState {
  obj: any;
  pathLen: number;
}

export class Reporter {
  
  _reporterState: ReporterState;

  constructor(options?: any) {
    this._reporterState = {
      obj: null,
      path: [],
      options: options || {},
      errors: []
    };
  }

  isError(obj: any) {
    return obj instanceof ReporterError;
  }

  saveReporter(): ReporterSaveState {
    const state = this._reporterState;
  
    return {
      obj: state.obj,
      pathLen: state.path.length,
    };
  }
  
  restoreReporter(data: ReporterSaveState) {
    const state = this._reporterState;
  
    state.obj = data.obj;
    state.path = state.path.slice(0, data.pathLen);
  }
  
  enterKey(key: string) {
    return this._reporterState.path.push(key);
  }
  
  exitKey(index: number) {
    const state = this._reporterState;
    state.path = state.path.slice(0, index - 1);
  }
  
  leaveKey(index: number, key?: string, value?: any) {
    const state = this._reporterState;
  
    this.exitKey(index);
    if (state.obj !== null) {
      state.obj[key!] = value; //TODO: This key! is weird coming from reporter._encodeValue
    }
  }
  
  path() {
    return this._reporterState.path.join('/');
  }
  
  enterObject() {
    const state = this._reporterState;
  
    const prev = state.obj;
    state.obj = {};

    return prev;
  }
  
  leaveObject(prev: any) {
    const state = this._reporterState;
  
    const now = state.obj;
    state.obj = prev;

    return now;
  }
  
  error(msg: string | Error | ReporterError) {
    let err;
    const state = this._reporterState;
  
    const inherited = msg instanceof ReporterError;
    if (inherited) {
      err = msg;
    } else {
      err = new ReporterError(state.path.map(function(elem) {
        return '[' + JSON.stringify(elem) + ']';
      }).join(''), (msg instanceof Error) ? msg.message : msg);
    }
  
    if (!state.options.partial) {
      throw err;
    }
  
    if (!inherited) {
      state.errors.push(err);
    }
  
    return err;
  }
  
  wrapResult(result: any) {
    const state = this._reporterState;

    if (!state.options.partial) {
      return result;
    }

    return {
      result: this.isError(result) ? null : result,
      errors: state.errors
    };
  }
}

export class ReporterError extends Error {
  constructor(public path: string, msg: string) {
    super(msg);
    this.rethrow(msg);
  }

  rethrow(msg: string) {
    this.message = msg + ' at: ' + (this.path || '(shallow)');
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ReporterError);
    }
  
    if (!this.stack) {
      try {
        // IE only adds stack when thrown
        throw new Error(this.message);
      } catch (e: any) {
        this.stack = e.stack;
      }
    }
    return this;
  }
}
