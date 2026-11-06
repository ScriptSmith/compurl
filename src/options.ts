export type OptionId =
  | "dotted"
  | "brackets"
  | "semicolons"
  | "lists"
  | "pipes"
  | "spaces"
  | "search"
  | "urls"
  | "queries"
  | "encoding"
  | "json"
  | "base64"
  | "compressed"
  | "jwt"
  | "tokens"
  | "rison"
  | "jsurl"
  | "protobuf"
  | "segments"
  | "matrix"
  | "textfrag"
  | "intent"
  | "maps"
  | "timestamps"
  | "signed"
  | "sets"
  | "case"
  | "loose"
  | "numbers";

/** Kept for code that only cares about decoding. */
export type DecoderId = OptionId;

export type Options = Record<OptionId, boolean>;

export interface OptionInfo {
  id: OptionId;
  label: string;
  example: string;
  on: boolean;
}

export interface OptionGroup {
  label: string;
  options: OptionInfo[];
}

export const GROUPS: readonly OptionGroup[] = [
  {
    label: "Keys",
    options: [
      { id: "dotted", label: "Dotted keys", example: "ui.theme=dark becomes ui › theme", on: true },
      {
        id: "brackets",
        label: "Bracket keys",
        example: "filter[size][]=9 becomes filter › size, a list",
        on: true,
      },
      {
        id: "semicolons",
        label: "Semicolon separators",
        example: "a=1;b=2 is read as two parameters",
        on: false,
      },
    ],
  },
  {
    label: "Lists",
    options: [
      { id: "lists", label: "Comma lists", example: "sort=price,-rating", on: true },
      { id: "pipes", label: "Pipe lists", example: "family=Inter|Roboto", on: true },
      { id: "spaces", label: "Space lists", example: "scope=openid profile email", on: true },
      {
        id: "search",
        label: "Search qualifiers",
        example: 'q=is:pr is:open label:"bug fix" crash becomes is, label and terms',
        on: true,
      },
    ],
  },
  {
    label: "Nesting",
    options: [
      {
        id: "urls",
        label: "Nested URLs",
        example: "return=https%3A%2F%2Fa.example%2F%3Fx%3D1 is split into its own parts",
        on: true,
      },
      {
        id: "queries",
        label: "Nested query strings",
        example: "state=a%3D1%26b%3D2 becomes a and b",
        on: true,
      },
      {
        id: "encoding",
        label: "Repeated encoding",
        example: "next=https%253A%252F%252Fa.example is decoded twice",
        on: true,
      },
    ],
  },
  {
    label: "Formats",
    options: [
      { id: "json", label: "JSON", example: 'f={"size":9} becomes f › size', on: true },
      {
        id: "base64",
        label: "Base64",
        example: "ctx=eyJzaXplIjo5fQ is decoded when it holds JSON, XML or a URL",
        on: true,
      },
      {
        id: "compressed",
        label: "Compressed",
        example: "gzip, zlib or deflate in base64 (Mermaid pako:, SAML), and lz-string",
        on: true,
      },
      {
        id: "jwt",
        label: "JWT",
        example: "eyJhbGci… becomes header, payload, signature",
        on: true,
      },
      {
        id: "tokens",
        label: "Signed tokens",
        example: "Flask/itsdangerous, Rails signed messages and PASETO",
        on: true,
      },
      {
        id: "rison",
        label: "Rison",
        example: "_g=(time:(from:now-7d)) becomes _g › time › from",
        on: true,
      },
      {
        id: "jsurl",
        label: "JSURL",
        example: "~(cols~(~'name~'age)) becomes cols, a list",
        on: true,
      },
      {
        id: "protobuf",
        label: "Base64 protobuf",
        example: "ved=0ahUKEwi… decoded without a schema; can misfire on random tokens",
        on: false,
      },
    ],
  },
  {
    label: "Paths and fragments",
    options: [
      {
        id: "segments",
        label: "Path segments",
        example: "/users/123/orders becomes a list",
        on: true,
      },
      {
        id: "matrix",
        label: "Matrix params",
        example: "/catalog;view=grid/ becomes matrix › catalog › view",
        on: true,
      },
      {
        id: "textfrag",
        label: "Text fragments",
        example: "#:~:text=quick-,brown,fox becomes prefix, start, end",
        on: true,
      },
      {
        id: "intent",
        label: "Android intents",
        example: "#Intent;package=com.example;S.ref=home;end",
        on: true,
      },
      {
        id: "maps",
        label: "Google Maps data",
        example: "/@-33.86,151.21,15z and data=!3m1!4b1 become fields",
        on: true,
      },
    ],
  },
  {
    label: "Annotations",
    options: [
      {
        id: "timestamps",
        label: "Timestamps",
        example: "Epoch seconds and milliseconds, UUIDv1/v7, ULID and Snowflake IDs get a date",
        on: true,
      },
      {
        id: "signed",
        label: "Signed URLs",
        example: "AWS, Google Cloud and Azure signing parameters, with the expiry time",
        on: true,
      },
    ],
  },
  {
    label: "Treat as equal",
    options: [
      { id: "sets", label: "Lists in any order", example: "a,b equals b,a", on: false },
      { id: "case", label: "Different case", example: "Dark equals dark", on: false },
      {
        id: "loose",
        label: "URL variations",
        example: "Default ports, trailing slashes and www. are ignored",
        on: false,
      },
      { id: "numbers", label: "Equal numbers", example: "1 equals 1.0 and 01", on: false },
    ],
  },
];

export const OPTIONS: readonly OptionInfo[] = GROUPS.flatMap((g) => g.options);
export const DECODERS = OPTIONS;

export const defaultOptions = (): Options =>
  Object.fromEntries(OPTIONS.map((o) => [o.id, o.on])) as Options;
