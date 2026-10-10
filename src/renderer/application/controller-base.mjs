/** Base for components sharing the editor's command and service context. */
export class ControllerBase {
  /** @param {object} application Editor composition context. */
  constructor(application) { this.application = application; }
}
