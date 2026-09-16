'use strict';

const { renderMusic } = require('../lib/inline-music');

// Article usage: {% music 1315821092 %} or {% music_playlist 18377839332 %}
const renderMusicTag = (args, type) => {
  if (args.length !== 1) {
    throw new Error(`The ${type === 'song' ? 'music' : 'music_playlist'} tag requires exactly one numeric ID.`);
  }

  return renderMusic(args[0], type);
};

hexo.extend.tag.register('music', (args) => renderMusicTag(args, 'song'));
hexo.extend.tag.register('music_playlist', (args) => renderMusicTag(args, 'playlist'));
