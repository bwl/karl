/**
 * Tree-sitter Query Patterns for Codemap Extraction
 *
 * Each language has specific patterns for extracting:
 * - Function definitions
 * - Class definitions
 * - Method definitions
 * - Interface/type definitions
 * - Import statements
 */

import type { SupportedLanguage } from './parser.js';

/**
 * Query patterns for each language
 * Uses tree-sitter's S-expression query syntax
 */
export const LANGUAGE_QUERIES: Record<SupportedLanguage, string> = {
  typescript: `
; Function declarations
(function_declaration
  name: (identifier) @function.name) @function.def

; Arrow functions assigned to const/let/var
(lexical_declaration
  (variable_declarator
    name: (identifier) @function.name
    value: (arrow_function))) @function.def

; Class declarations
(class_declaration
  name: (type_identifier) @class.name) @class.def

; Method definitions
(method_definition
  name: (property_identifier) @method.name) @method.def

; Interface declarations
(interface_declaration
  name: (type_identifier) @interface.name) @interface.def

; Type alias declarations
(type_alias_declaration
  name: (type_identifier) @type.name) @type.def

; Enum declarations
(enum_declaration
  name: (identifier) @enum.name) @enum.def

; Import statements
(import_statement) @import

; Export statements
(export_statement) @export
`,

  tsx: `
; Function declarations
(function_declaration
  name: (identifier) @function.name) @function.def

; Arrow functions assigned to const/let/var
(lexical_declaration
  (variable_declarator
    name: (identifier) @function.name
    value: (arrow_function))) @function.def

; Class declarations
(class_declaration
  name: (type_identifier) @class.name) @class.def

; Method definitions
(method_definition
  name: (property_identifier) @method.name) @method.def

; Interface declarations
(interface_declaration
  name: (type_identifier) @interface.name) @interface.def

; Type alias declarations
(type_alias_declaration
  name: (type_identifier) @type.name) @type.def

; Enum declarations
(enum_declaration
  name: (identifier) @enum.name) @enum.def

; Import statements
(import_statement) @import

; Export statements
(export_statement) @export
`,

  javascript: `
; Function declarations
(function_declaration
  name: (identifier) @function.name) @function.def

; Arrow functions assigned to const/let/var
(lexical_declaration
  (variable_declarator
    name: (identifier) @function.name
    value: (arrow_function))) @function.def

; Class declarations
(class_declaration
  name: (identifier) @class.name) @class.def

; Method definitions
(method_definition
  name: (property_identifier) @method.name) @method.def

; Import statements
(import_statement) @import

; Export statements
(export_statement) @export
`,

  python: `
; Function definitions
(function_definition
  name: (identifier) @function.name) @function.def

; Async function definitions
(function_definition
  "async"
  name: (identifier) @async_function.name) @async_function.def

; Class definitions
(class_definition
  name: (identifier) @class.name) @class.def

; Import statements
(import_statement) @import
(import_from_statement) @import

; Decorated definitions (capture the decorator too)
(decorated_definition
  (function_definition
    name: (identifier) @function.name)) @decorated.def
`,

  rust: `
; Function definitions
(function_item
  name: (identifier) @function.name) @function.def

; Struct definitions
(struct_item
  name: (type_identifier) @struct.name) @struct.def

; Enum definitions
(enum_item
  name: (type_identifier) @enum.name) @enum.def

; Trait definitions
(trait_item
  name: (type_identifier) @trait.name) @trait.def

; Impl blocks
(impl_item
  type: (type_identifier) @impl.type) @impl.def

; Type aliases
(type_item
  name: (type_identifier) @type.name) @type.def

; Module definitions
(mod_item
  name: (identifier) @module.name) @module.def

; Use statements
(use_declaration) @import
`,

  go: `
; Function declarations
(function_declaration
  name: (identifier) @function.name) @function.def

; Method declarations
(method_declaration
  name: (field_identifier) @method.name
  receiver: (parameter_list
    (parameter_declaration
      type: [(type_identifier) (pointer_type)]))) @method.def

; Type declarations (struct, interface, etc.)
(type_declaration
  (type_spec
    name: (type_identifier) @type.name)) @type.def

; Import declarations
(import_declaration) @import
`,

  java: `
; Class declarations
(class_declaration
  name: (identifier) @class.name) @class.def

; Interface declarations
(interface_declaration
  name: (identifier) @interface.name) @interface.def

; Method declarations
(method_declaration
  name: (identifier) @method.name) @method.def

; Constructor declarations
(constructor_declaration
  name: (identifier) @constructor.name) @constructor.def

; Enum declarations
(enum_declaration
  name: (identifier) @enum.name) @enum.def

; Import declarations
(import_declaration) @import
`,

  c: `
; Function definitions
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @function.name)) @function.def

; Struct specifiers
(struct_specifier
  name: (type_identifier) @struct.name) @struct.def

; Enum specifiers
(enum_specifier
  name: (type_identifier) @enum.name) @enum.def

; Type definitions
(type_definition
  declarator: (type_identifier) @type.name) @type.def

; Include statements
(preproc_include) @import
`,

  cpp: `
; Function definitions
(function_definition
  declarator: (function_declarator
    declarator: [(identifier) (qualified_identifier)] @function.name)) @function.def

; Class specifiers
(class_specifier
  name: (type_identifier) @class.name) @class.def

; Struct specifiers
(struct_specifier
  name: (type_identifier) @struct.name) @struct.def

; Enum specifiers
(enum_specifier
  name: (type_identifier) @enum.name) @enum.def

; Namespace definitions
(namespace_definition
  name: (identifier) @namespace.name) @namespace.def

; Type definitions
(type_definition
  declarator: (type_identifier) @type.name) @type.def

; Include statements
(preproc_include) @import
`,

  csharp: `
; Class declarations
(class_declaration
  name: (identifier) @class.name) @class.def

; Interface declarations
(interface_declaration
  name: (identifier) @interface.name) @interface.def

; Struct declarations
(struct_declaration
  name: (identifier) @struct.name) @struct.def

; Method declarations
(method_declaration
  name: (identifier) @method.name) @method.def

; Property declarations
(property_declaration
  name: (identifier) @property.name) @property.def

; Enum declarations
(enum_declaration
  name: (identifier) @enum.name) @enum.def

; Using directives
(using_directive) @import
`,

  swift: `
; Function declarations
(function_declaration
  name: (simple_identifier) @function.name) @function.def

; Class declarations
(class_declaration
  name: (type_identifier) @class.name) @class.def

; Struct declarations
(struct_declaration
  name: (type_identifier) @struct.name) @struct.def

; Protocol declarations
(protocol_declaration
  name: (type_identifier) @protocol.name) @protocol.def

; Enum declarations
(enum_declaration
  name: (type_identifier) @enum.name) @enum.def

; Extension declarations
(extension_declaration) @extension.def

; Import statements
(import_declaration) @import
`,

  ruby: `
; Method definitions
(method
  name: (identifier) @method.name) @method.def

; Singleton method definitions
(singleton_method
  name: (identifier) @method.name) @method.def

; Class definitions
(class
  name: (constant) @class.name) @class.def

; Module definitions
(module
  name: (constant) @module.name) @module.def

; Require/require_relative statements
(call
  method: [(identifier) @_require]
  (#match? @_require "^require")) @import
`,

  php: `
; Function definitions
(function_definition
  name: (name) @function.name) @function.def

; Class declarations
(class_declaration
  name: (name) @class.name) @class.def

; Interface declarations
(interface_declaration
  name: (name) @interface.name) @interface.def

; Trait declarations
(trait_declaration
  name: (name) @trait.name) @trait.def

; Method declarations
(method_declaration
  name: (name) @method.name) @method.def

; Namespace definitions
(namespace_definition
  name: (namespace_name) @namespace.name) @namespace.def

; Use declarations
(namespace_use_declaration) @import
`,
};

/**
 * Get query string for a language
 */
export function getQueryForLanguage(lang: SupportedLanguage): string {
  return LANGUAGE_QUERIES[lang];
}
