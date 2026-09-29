/** Title screen with the educational disclaimer. Resolves when the user starts. */
export function showStartScreen(root: HTMLElement): Promise<void> {
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
      <ul>
        <li><b>Tab</b> switches between the 3D view and live fluoroscopy</li>
        <li>Hold <b>Space</b> for fluoroscopy, press <b>C</b> for a contrast injection (cine)</li>
        <li><b>V</b> cycles the C-arm projections, arrow keys fine-tune the angle</li>
      </ul>
      <button class="primary" id="start-btn">ENTER THE CATH LAB</button>
    </div>`;
  root.appendChild(el);
  return new Promise((resolve) => {
    el.querySelector<HTMLButtonElement>('#start-btn')!.addEventListener('click', () => {
      el.remove();
      resolve();
    });
  });
}
