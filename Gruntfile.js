module.exports = function (grunt) {
  require('matchdep').filterDev('grunt-*').forEach(grunt.loadNpmTasks);

  // Project configuration.
  grunt.initConfig({
    jshint: {
      options: grunt.file.readJSON('.jshintrc'),
      src: ['src/*.js']
    },
    browserify: {
      lib: {
        src: 'src/glsl-transition-core.js',
        dest: 'dist/glsl-transition-core.js',
        options: {
          standalone: "GlslTransitionCore"
        }
      },
      test: {
        src: 'test/index.js',
        dest: 'test/bundle.js',
        options: {
          debug: true
        }
      }
    },
    watch: {
      lib: {
        files: '<%= browserify.lib.src %>',
        tasks: ['jshint', 'browserify:lib']
      },
      test: {
        files: ['test/**.js', '!test/bundle.js'],
        tasks: ['browserify:test']
      }
    }
  });


  grunt.registerTask('default', ['build', 'watch']);
  grunt.registerTask('build', ['jshint', 'browserify']);
};
