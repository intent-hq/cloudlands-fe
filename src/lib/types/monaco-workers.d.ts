/**
 * Type declarations for Monaco Editor worker imports
 */

declare module 'monaco-editor/editor/editor.worker?worker' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}

declare module 'monaco-editor/language/json/json.worker?worker' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}

declare module 'monaco-editor/language/css/css.worker?worker' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}

declare module 'monaco-editor/language/html/html.worker?worker' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}

declare module 'monaco-editor/language/typescript/ts.worker?worker' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}

// Inline worker imports (embedded as blob URLs)
declare module 'monaco-editor/editor/editor.worker?worker&inline' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}

declare module 'monaco-editor/language/json/json.worker?worker&inline' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}

declare module 'monaco-editor/language/css/css.worker?worker&inline' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}

declare module 'monaco-editor/language/html/html.worker?worker&inline' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}

declare module 'monaco-editor/language/typescript/ts.worker?worker&inline' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
