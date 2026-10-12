import {ControllerBase} from '../controller-base.mjs';
import {TimelineCleanupViewModel} from '../../viewmodel/timeline-cleanup-view-model.mjs';
import {TimelineCleanupDialog} from '../../view/timeline-cleanup-dialog.mjs';

/** Resolve live tool edits and coordinate previewed timeline cleanup commands. */
export class TimelineCleanupController extends ControllerBase {
  initializeCleanupEvents() {
    const runtime = this.application;
    const button = document.querySelector('#timeline-cleanup');
    const update = () => { button.disabled = !runtime.vm.project.clips.length; };
    runtime.vm.subscribe(update);
    update();
    button.addEventListener('click', async () => {
      await runtime.runImageListAction(async () => {
        const revision = runtime.vm.editRevision;
        const selected = [...runtime.vm.selectedClipIds];
        const draft = new TimelineCleanupViewModel(runtime.vm.project,selected);
        const result = await new TimelineCleanupDialog(draft,{
          resolveImage:image => runtime.materializeWorkingImage(image),
          releaseImages:paths => window.frameLine.discardProcessedImages(paths)
        }).open();
        if (result) runtime.vm.cleanupTimeline(result.options,selected,revision,result.plan);
      });
      runtime.scroll.focus({preventScroll:true});
    });
  }
}
