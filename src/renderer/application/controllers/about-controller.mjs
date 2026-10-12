import {ControllerBase} from '../controller-base.mjs';
import {AboutDialog} from '../../view/about-dialog.mjs';

/** Coordinate the About window without changing the active project or pending edits. */
export class AboutController extends ControllerBase {
  initializeAboutEvents() {
    const runtime = this.application;
    const view = new AboutDialog(name => window.frameLine.openAppLink(name),runtime.notifyError,
      name => window.frameLine.copyAppContact(name));
    document.querySelector('#app-about').addEventListener('click',() => {
      runtime.stopPlayback();
      runtime.renderPlayButton();
      void view.open(() => window.frameLine.getAppInfo());
    });
  }
}
