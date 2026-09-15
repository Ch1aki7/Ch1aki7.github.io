'use strict';

// Article usage: {% music 1315821092 %} or {% music_playlist 18377839332 %}
const renderMusic = (args, type) => {
  const id = args[0];
  if (args.length !== 1 || !/^\d+$/.test(id || '')) {
    throw new Error(`The ${type === 'song' ? 'music' : 'music_playlist'} tag requires exactly one numeric ID.`);
  }

  const isPlaylist = type === 'playlist';
  return `
<div class="inline-music">
  <meting-js server="netease" type="${type}" id="${id}" fixed="false" mini="false" autoplay="false" loop="${isPlaylist ? 'all' : 'none'}" order="list" preload="none" volume="0.3" mutex="true" list-folded="${!isPlaylist}" list-max-height="260px" storage-name="zaphkiel-inline-music"></meting-js>
</div>`;
};

hexo.extend.tag.register('music', (args) => renderMusic(args, 'song'));
hexo.extend.tag.register('music_playlist', (args) => renderMusic(args, 'playlist'));
