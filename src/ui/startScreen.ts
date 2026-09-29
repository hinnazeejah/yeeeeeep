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
        <li>Tools on the bottom bar, keys <b>1–7</b>. Hover a tool to read its rules.</li>
        <li><b>W/S</b> or the mouse wheel push and pull the device, <b>A/D</b> rotate it, hold <b>Shift</b> for fine control</li>
        <li><b>Tab</b> switches between the 3D view and live fluoroscopy. Hold <b>Space</b> (or 6) for X-ray, press <b>5</b> to inject contrast</li>
        <li><b>V</b> cycles the C-arm projections, arrow keys fine-tune the angle. <b>F</b> toggles camera follow</li>
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
