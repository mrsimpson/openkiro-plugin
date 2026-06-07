declare module "better-sqlite3" {
  class Database {
    constructor(path: string, options?: { readonly?: boolean });
    prepare(sql: string): { get(...params: any[]): any };
    close(): void;
  }
  export default Database;
}
