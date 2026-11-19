/**
 * Une promesse qu'on résout de l'extérieur. Sert à lancer l'envoi d'une
 * sauvegarde vers le compte **pendant** sa lecture : l'envoi part tout de
 * suite, et n'attend les compteurs (fournis par la lecture) que pour la
 * confirmation finale.
 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Une lecture ratée rejette la promesse avant que l'envoi ne l'attende :
  // sans ce gestionnaire, le runtime signalerait un rejet non traité.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

/** Rejet d'une lecture ratée : l'envoi s'arrête sans afficher d'erreur de plus. */
export class ReadAborted extends Error {
  constructor() {
    super('lecture abandonnée');
    this.name = 'ReadAborted';
  }
}
