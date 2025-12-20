import BlurayPlayer from '../../dist/BlurayPlayer.js';

document.querySelector('button').onclick = async function() {
    const player = await BlurayPlayer.load();
    if (!player) return;
}