'use babel';

export function once(event, emitter, callback) {
  const subscription = emitter.on(event, () => {
    subscription.dispose();
    callback();
  });
}
