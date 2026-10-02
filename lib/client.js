window.__ModuleLoader__.load({ id: "dsh-reme-auto-router", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  ENTRY_ID: () => ENTRY_ID,
  NS: () => NS,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/RemeCard.tsx
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/locales.ts
var en = {
  title: "ReMe Auto Router",
  description: "Choose the DSH provider route and model handed to workspace-bound reme instances.",
  provider: "Provider",
  providerHint: "DSH provider route reme calls its LLM through. Leave blank to inherit the host default-model selection. The credential and endpoint are read from this provider\u2019s DSH configuration.",
  model: "Model",
  modelHint: "Model id reme calls. Leave blank to inherit the host default-model selection.",
  overridden: "Overridden",
  reset: "Reset to default",
  readOnly: "This deployment stores settings read-only.",
  unavailable: "This plugin\u2019s settings are not being served by the Host right now; check that the plugin is enabled in this profile.",
  save: "Save",
  saving: "Saving\u2026",
  saveFailed: "The deployment did not accept these values; they were left for you to correct.",
  invalidText: "Enter a value, or leave blank to inherit the default."
};
var zh = {
  title: "ReMe \u81EA\u52A8\u8DEF\u7531",
  description: "\u9009\u62E9\u4EA4\u7ED9\u5DE5\u4F5C\u533A reme \u5B9E\u4F8B\u7684 DSH provider \u8DEF\u7531\u4E0E\u6A21\u578B\u3002",
  provider: "Provider",
  providerHint: "reme \u8C03\u7528 LLM \u7528\u7684 DSH provider \u8DEF\u7531\u3002\u7559\u7A7A\u5219\u7EE7\u627F\u5BBF\u4E3B\u9ED8\u8BA4\u6A21\u578B\u9009\u62E9;\u51ED\u636E\u4E0E\u7AEF\u70B9\u81EA\u52A8\u53D6\u81EA\u8BE5 provider \u5728 DSH \u91CC\u7684\u914D\u7F6E\u3002",
  model: "Model",
  modelHint: "reme \u8C03\u7528 LLM \u7528\u7684\u6A21\u578B id\u3002\u7559\u7A7A\u5219\u7EE7\u627F\u5BBF\u4E3B\u9ED8\u8BA4\u6A21\u578B\u9009\u62E9\u3002",
  overridden: "\u5DF2\u8986\u76D6",
  reset: "\u6062\u590D\u9ED8\u8BA4",
  readOnly: "\u672C\u90E8\u7F72\u7684\u8BBE\u7F6E\u4E3A\u53EA\u8BFB\u3002",
  unavailable: "\u5BBF\u4E3B\u5F53\u524D\u6CA1\u6709\u63D0\u4F9B\u672C\u63D2\u4EF6\u7684\u8BBE\u7F6E\u547D\u540D\u7A7A\u95F4;\u8BF7\u786E\u8BA4\u8BE5\u63D2\u4EF6\u5DF2\u5728\u5F53\u524D profile \u542F\u7528\u3002",
  save: "\u4FDD\u5B58",
  saving: "\u4FDD\u5B58\u4E2D\u2026",
  saveFailed: "\u672C\u90E8\u7F72\u6CA1\u6709\u63A5\u53D7\u8FD9\u4E9B\u503C,\u5DF2\u4FDD\u7559\u4F9B\u4F60\u4FEE\u6539\u3002",
  invalidText: "\u586B\u5199\u503C;\u7559\u7A7A\u8868\u793A\u7EE7\u627F\u9ED8\u8BA4\u3002"
};
function formLabels(t) {
  return {
    unavailable: t("unavailable"),
    readOnly: t("readOnly"),
    saveFailed: t("saveFailed"),
    save: t("save"),
    saving: t("saving")
  };
}

// src/client/RemeCard.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function RemeCard(props) {
  const { t } = props;
  const state = props.useRemeCard((snapshot) => snapshot);
  if (props.view === "summary") return t("description");
  const disabled = !state.writable;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_dsh_client_ui_primitives.SettingsForm, { labels: formLabels(t), state, onSave: props.save, onDiscard: props.discard, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_dsh_client_ui_primitives.SettingsValueField,
      {
        id: "plugin-config-reme-auto-router-provider",
        label: t("provider"),
        hint: t("providerHint"),
        overriddenLabel: t("overridden"),
        resetLabel: t("reset"),
        invalidLabel: t("invalidText"),
        disabled,
        ...state.provider,
        onEdit: (text) => {
          props.edit("provider", text);
        },
        onReset: () => {
          props.resetField("provider");
        }
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_dsh_client_ui_primitives.SettingsValueField,
      {
        id: "plugin-config-reme-auto-router-model",
        label: t("model"),
        hint: t("modelHint"),
        overriddenLabel: t("overridden"),
        resetLabel: t("reset"),
        invalidLabel: t("invalidText"),
        disabled,
        ...state.model,
        onEdit: (text) => {
          props.edit("model", text);
        },
        onReset: () => {
          props.resetField("model");
        }
      }
    )
  ] });
}

// src/client/card-seat.ts
var NS = "dsh-reme-auto-router";
var ENTRY_ID = "dsh-reme-auto-router";
var CARD_ID = "reme-auto-router";
var CARD_ORDER = 50;
var CLIENT_INJECT = ["slots", "locale", "configForms"];
function cardSeatOptions(t, inject2) {
  return {
    name: "plugins.item",
    id: CARD_ID,
    order: CARD_ORDER,
    label: () => t("title"),
    locale: NS,
    inject: inject2
  };
}

// src/client/llm-form-scope.ts
var SECTION = "llm";
var LlmScope = class {
  /** @param form - the shared configuration form of the plugin's own entry. */
  constructor(form) {
    this.form = form;
  }
  form;
  /**
   * Project the entry snapshot onto the flat `llm` view.
   * @returns the section values, the composition layer, and the raw user layer.
   */
  getSnapshot() {
    const snapshot = this.form.getSnapshot();
    return {
      status: snapshot.status,
      value: snapshot.value?.llm,
      base: snapshot.base?.llm,
      user: snapshot.user?.llm,
      writable: snapshot.writable,
      revision: snapshot.revision
    };
  }
  /**
   * Observe snapshot replacements.
   * @param listener - invoked after each snapshot change.
   * @returns the disposer removing this listener.
   */
  subscribe(listener) {
    return this.form.subscribe(listener);
  }
  /**
   * Nest every staged field operation under `llm` and write it in one fence.
   * @param ops - the card's flat field edits, in staging order.
   * @param expectedRevision - the revision the drafts were staged against.
   * @returns whether the Host accepted the write, after any recovery read.
   */
  mutate(ops, expectedRevision) {
    const nested = ops.map((op) => op.op === "set" ? { op: "set", path: [SECTION, ...op.path], value: op.value } : { op: "unset", path: [SECTION, ...op.path] });
    return this.form.mutate(nested, expectedRevision);
  }
};

// src/client/reme-card-controller.ts
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
var RemeCardController = class {
  form;
  store;
  /** @param scope - the shared configuration form of the plugin's own entry, projected onto `llm`. */
  constructor(scope) {
    this.form = new import_dsh_client_ui_primitives2.SettingsFormModel(scope, [
      (0, import_dsh_client_ui_primitives2.settingsTextField)("provider"),
      (0, import_dsh_client_ui_primitives2.settingsTextField)("model")
    ]);
    this.store = this.form.bind(() => this.projection());
  }
  projection() {
    return {
      ...this.form.shell(),
      provider: this.form.field("provider"),
      model: this.form.field("model")
    };
  }
  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject() {
    return { hooks: { remeCard: this.store }, ...this.form.actions() };
  }
  /** Release the form subscription. */
  dispose() {
    this.form.dispose();
  }
};

// src/client/index.ts
var inject = [...CLIENT_INJECT];
function apply(ctx) {
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "reme-auto-router: card dictionaries");
  const controller = new RemeCardController(new LlmScope(ctx.configForms.get(ENTRY_ID)));
  ctx.effect(() => () => {
    controller.dispose();
  }, "reme-auto-router: form subscription");
  ctx.effect(
    () => ctx.slots.inject("plugins.item", () => ctx.slots.register(cardSeatOptions(t, () => controller.inject()), RemeCard)),
    "reme-auto-router: plugins page card"
  );
}
return module.exports; } });
//# sourceMappingURL=client.js.map
