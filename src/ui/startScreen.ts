export type StartChoice = 'play' | 'demo';

/** Title screen with the case vignette and educational disclaimer. Resolves with the chosen mode. */
export function showStartScreen(root: HTMLElement): Promise<StartChoice> {
  const el = document.createElement('div');
  el.id = 'start';
  el.innerHTML = `
    <div class="card panel">
      <h1>PCI SIMULATOR</h1>
      <div class="sub">Stenting a mid-LAD lesion via right radial access</div>
      <div class="disclaimer">
        <strong>For education and demonstration only.</strong> This is a simplified simulation.
        It is not clinical training, is not validated against real patients, and is not medical advice.
      </div>
      <div class="case">
        <div class="panel-title">THE CASE</div>
        <p>A 68-year-old (80 kg) with exertional chest pain limiting daily activity despite full medical therapy.
        A stress test shows anterior-wall ischaemia. Angiography found a <b>90% stenosis of the mid left anterior
        descending (LAD) artery</b>, between the first and second diagonal branches. The team has recommended
        percutaneous coronary intervention (PCI) with a drug-eluting stent.</p>
      </div>
      <div class="cols">
        <div>
          <div class="panel-title">YOU WILL</div>
          <ol>
            <li>Bring a guide catheter from the wrist to the aortic root</li>
            <li>Engage the left main and take an angiogram</li>
            <li>Give heparin, then steer a wire across the lesion</li>
            <li>Pre-dilate with a balloon</li>
            <li>Measure, size and deploy a stent</li>
            <li>Confirm the result, then read your debrief</li>
          </ol>
        </div>
        <div>
          <div class="panel-title">CONTROLS</div>
          <ul>
            <li><b>1–7</b> tools (hover for rules), <b>W/S</b> or wheel push/pull, <b>A/D</b> rotate, <b>Shift</b> fine</li>
            <li><b>Space</b> fluoro, <b>5</b> contrast, <b>Tab</b> 3D / X-ray, <b>V</b> C-arm angle</li>
            <li><b>E</b> inflate, <b>Q</b> deflate, <b>G</b> heparin, <b>Esc</b> pause, <b>H</b> all keys</li>
          </ul>
        </div>
      </div>
      <div class="start-buttons">
        <button class="primary" id="start-btn">ENTER THE CATH LAB</button>
        <button class="ghost" id="demo-btn">Watch a demo first</button>
        <span class="dim">In the demo, press any key or click to take over.</span>
      </div>
    </div>`;
  root.appendChild(el);
  return new Promise((resolve) => {
    const go = (c: StartChoice) => {
      el.remove();
      resolve(c);
    };
    el.querySelector<HTMLButtonElement>('#start-btn')!.addEventListener('click', () => go('play'));
    el.querySelector<HTMLButtonElement>('#demo-btn')!.addEventListener('click', () => go('demo'));
  });
}
