export class Database {
  constructor(_path: string, _options?: { readonly?: boolean }) {}
  query(_sql: string) {
    return { get: () => null };
  }
  close() {}
}
