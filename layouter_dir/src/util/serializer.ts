export default class Serializer {
    static repeatFunction(fun: any, times: number, wait: number = 0,
                          foldFun: (prev: any, current: typeof prev) => typeof prev = () => {},
                          foldNeutral: any = null): Promise<any> {
        const createRun = (run, prev, resolve) => {
            return new Promise(resolve => setTimeout(resolve, wait)).then(() => {
                const current = fun(run);
                const next = foldFun(prev, current);
                if (run + 1 < times) {
                    return createRun(run + 1, next, resolve);
                }
                return resolve(next);
            });
        };
        return new Promise(resolve => createRun(0, foldNeutral, resolve));
    }

    static async serializePromises(promises: Array<Promise<any>>): Promise<Array<any>> {
        const results = [];

        function createPromise(promise: Promise<any>) {
            return new Promise(resolve => {
                promise.then((result) => resolve(result));
            });
        }

        for (let p = 0; p < promises.length; ++p) {
            results.push(await createPromise(promises[p]));
        }
        return results;
    }
}
