var obsidian = require('obsidian');

module.exports = class TestPlugin extends obsidian.Plugin {
    onload() {
        console.log('Test plugin loaded!');
        new obsidian.Notice('Test plugin works!');
    }

    onunload() {
        console.log('Test plugin unloaded');
    }
};
