declare module 'blessed' {
  // Minimal type shims to satisfy TypeScript without installing blessed
  // If the real package is installed, these will be replaced by its typings.
  namespace blessed {
    namespace Widgets {
      interface ScreenOptions {
        smartCSR?: boolean;
        title?: string;
        fullUnicode?: boolean;
      }
      class Screen {
        constructor(opts?: ScreenOptions);
        key(keys: string | string[], handler: (...args: any[]) => void): void;
        render(): void;
        destroy(): void;
        append(node: any): void;
      }

      interface BoxOptions {
        parent?: any;
        label?: string;
        top?: number | string;
        left?: number | string;
        width?: number | string;
        height?: number | string;
        bottom?: number | string;
        border?: any;
        style?: any;
        scrollable?: boolean;
        alwaysScroll?: boolean;
        mouse?: boolean;
        content?: string;
        inputOnFocus?: boolean;
      }
      class BoxElement {
        setContent(content: string): void;
        setLabel(label: string): void;
        focus(): void;
        key(keys: string | string[], handler: (...args: any[]) => void): void;
        display(message: string, timeout?: number, callback?: () => void): void;
      }

      interface ListOptions extends BoxOptions {
        keys?: boolean;
        vi?: boolean;
        scrollbar?: any;
      }
      class ListElement extends BoxElement {
        setItems(items: string[]): void;
        select(index: number): void;
        on(event: string, handler: (...args: any[]) => void): void;
        getItem(index: number): any;
        length: number;
      }

      class TextboxElement extends BoxElement {
        readInput(callback?: (err?: any, value?: string) => void): void;
        setValue(value: string): void;
        getValue(): string;
        clearValue(): void;
        on(event: string, handler: (...args: any[]) => void): void;
      }
    }

    function screen(opts?: Widgets.ScreenOptions): Widgets.Screen;
    function list(opts?: Widgets.ListOptions): Widgets.ListElement;
    function box(opts?: Widgets.BoxOptions): Widgets.BoxElement;
    function textbox(opts?: Widgets.BoxOptions): Widgets.TextboxElement;
    function message(opts?: Widgets.BoxOptions): Widgets.BoxElement;
  }

  export = blessed;
}
