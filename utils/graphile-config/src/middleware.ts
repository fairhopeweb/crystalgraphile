import type {
  CallbackOrDescriptor,
  FunctionalityObject,
  PromiseOrDirect,
} from "./interfaces.js";
import { isPromiseLike } from "./utils.js";

export interface MiddlewareNext<
  TRawResult,
  TAwaitedResult = Awaited<TRawResult>,
> {
  (): TRawResult;
  callback(
    callback: (
      params:
        | { error: object; result?: never }
        | { error?: undefined; result: TAwaitedResult },
    ) => TRawResult,
  ): TRawResult;
}

type ActivityFn<
  TActivities extends FunctionalityObject<TActivities>,
  TActivityName extends keyof TActivities,
> = TActivities[TActivityName] extends CallbackOrDescriptor<infer UFn>
  ? UFn
  : never;
type ActivityParameter<
  TActivities extends FunctionalityObject<TActivities>,
  TActivityName extends keyof TActivities,
> = TActivities[TActivityName] extends CallbackOrDescriptor<
  (arg: infer UArg) => any
>
  ? UArg
  : never;

type RealActivityFn<
  TActivities extends FunctionalityObject<TActivities>,
  TActivityName extends keyof TActivities,
> = TActivities[TActivityName] extends CallbackOrDescriptor<
  (arg: infer UArg) => infer UResult
>
  ? (next: MiddlewareNext<UResult>, arg: UArg) => UResult
  : never;

export class Middlewares<TActivities extends FunctionalityObject<TActivities>> {
  middlewares: {
    [key in keyof TActivities]?: Array<RealActivityFn<TActivities, key>>;
  } = Object.create(null);

  register<TActivityName extends keyof TActivities>(
    event: TActivityName,
    fn: RealActivityFn<TActivities, TActivityName>,
  ): void {
    const list = this.middlewares[event];
    if (list !== undefined) {
      list.push(fn);
    } else {
      this.middlewares[event] = [fn];
    }
  }

  run<TActivityName extends keyof TActivities>(
    activityName: TActivityName,
    arg: ActivityParameter<TActivities, TActivityName>,
    activity: (
      arg: ActivityParameter<TActivities, TActivityName>,
    ) => ReturnType<ActivityFn<TActivities, TActivityName>>,
  ): ReturnType<ActivityFn<TActivities, TActivityName>> {
    const middlewares = this.middlewares[activityName];
    if (middlewares === undefined) {
      return activity(arg);
    }
    const m = middlewares.length - 1;
    return executeMiddleware(
      activityName,
      true,
      middlewares,
      activity,
      arg,
      0,
      m,
    );
  }
  runSync<TActivityName extends keyof TActivities>(
    activityName: TActivityName,
    arg: ActivityParameter<TActivities, TActivityName>,
    activity: (
      arg: ActivityParameter<TActivities, TActivityName>,
    ) => ReturnType<ActivityFn<TActivities, TActivityName>>,
  ): ReturnType<ActivityFn<TActivities, TActivityName>> {
    const middlewares = this.middlewares[activityName];
    if (middlewares === undefined) {
      return activity(arg);
    }
    const m = middlewares.length - 1;
    return executeMiddleware(
      activityName,
      false,
      middlewares,
      activity,
      arg,
      0,
      m,
    );
  }
}

function executeMiddleware<
  TActivities extends FunctionalityObject<TActivities>,
  TActivityName extends keyof TActivities,
>(
  activityName: TActivityName,
  allowAsync: boolean,
  middlewares: ReadonlyArray<RealActivityFn<TActivities, TActivityName>>,
  activity: (
    arg: ActivityParameter<TActivities, TActivityName>,
  ) => ReturnType<ActivityFn<TActivities, TActivityName>>,
  arg: ActivityParameter<TActivities, TActivityName>,
  idx: number,
  maxIdx: number,
): ReturnType<ActivityFn<TActivities, TActivityName>> {
  const next = makeNext<ReturnType<ActivityFn<TActivities, TActivityName>>>(
    idx === maxIdx
      ? () => activity(arg)
      : () =>
          executeMiddleware(
            activityName,
            allowAsync,
            middlewares,
            activity,
            arg,
            idx + 1,
            maxIdx,
          ),
  );
  const middleware = middlewares[idx];
  const result = middleware(
    next as MiddlewareNext<unknown, unknown>,
    arg,
  ) as any;
  if (!allowAsync && isPromiseLike(result)) {
    throw new Error(
      `'${String(
        activityName,
      )}' is a synchronous activity, all middlewares must be synchronous but the middleware at index ${idx} returned a promise.`,
    );
  }
  return result;
}

function makeNext<TRawResult, TAwaitedResult = Awaited<TRawResult>>(
  fn: () => TRawResult,
): MiddlewareNext<TRawResult, TAwaitedResult> {
  let called = false;
  const next = fn as MiddlewareNext<TRawResult, TAwaitedResult>;
  next.callback = (callback) => {
    if (called) {
      throw new Error(`next() was already called; don't call it twice!`);
    }
    called = true;
    let result: PromiseOrDirect<TAwaitedResult>;
    try {
      result = fn() as PromiseOrDirect<TAwaitedResult>;
    } catch (error) {
      return callback({ error });
    }
    if (isPromiseLike(result)) {
      return result.then(
        (result) => callback({ result }),
        (error) => callback({ error }),
      ) as TRawResult;
    } else {
      return callback({ result });
    }
  };
  return next;
}
