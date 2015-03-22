var createShader = require("gl-shader");
var createTexture = require("gl-texture2d");

var VERTEX_SHADER = 'attribute vec2 position; void main() { gl_Position = vec4(2.0*position-1.0, 0.0, 1.0);}';
var PROGRESS_UNIFORM = "progress";
var RESOLUTION_UNIFORM = "resolution";

var CONTEXTS = ["webgl", "experimental-webgl"];
function getWebGLContext (canvas, options) {
  if (!canvas.getContext) return;
  for (var i = 0; i < CONTEXTS.length; ++i) {
    try {
      var ctx = canvas.getContext(CONTEXTS[i], options||{});
      if (ctx) return ctx;
    } catch(e) {
    }
  }
}

function extend (obj) {
  for(var a=1; a<arguments.length; ++a) {
    var source = arguments[a];
    for (var prop in source)
      if (source[prop] !== void 0) obj[prop] = source[prop];
  }
  return obj;
}

/**
 * API:
 * GlslTransitionCore(canvas)(glslSource, options) => Object with functions.
 */

/**
 * ~~~ First Call in the API
 * GlslTransitionCore(canvas)
 * Creates a Transitions context with a canvas.
 */
function GlslTransitionCore (canvas, opts) {
  if (arguments.length !== 1 || !("getContext" in canvas))
    throw new Error("Bad arguments. usage: GlslTransitionCore(canvas)");

  var contextAttributes = extend({}, opts && opts.contextAttributes || {}, GlslTransitionCore.defaults.contextAttributes);

  // First level variables
  var gl, currentShader, transitions;
  var userContextLostWatchers = [];

  function init () {
    transitions = [];
    gl = getWebGLContext(canvas, contextAttributes);
    canvas.addEventListener("webglcontextlost", onContextLost, false);
    canvas.addEventListener("webglcontextrestored", onContextRestored, false);
  }

  function onContextLost (e) {
    e.preventDefault();
    gl = null;
    for (var i=0; i<transitions.length; ++i) {
      transitions[i].onContextLost(e);
    }
  }

  function onContextRestored (e) {
    gl = getWebGLContext(canvas, contextAttributes);
    var i;
    for (i=0; i<userContextLostWatchers.length; ++i) {
      userContextLostWatchers[i](e);
    }
    for (i=0; i<transitions.length; ++i) {
      transitions[i].onContextRestored(e);
    }
  }

  function draw () {
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /**
   * ~~~ Second Call in the API
   * createTransition(glslSource, [uniforms])
   * Creates a GLSL Transition for the current canvas context.
   */
  function createTransition (glsl) {
    // Second level variables
    var buffer, shader, textureUnits, textures;

    function load () {
      if (!gl) return;
      buffer = gl.createBuffer();
      shader = createShader(gl, VERTEX_SHADER, glsl);
      
      textureUnits = {};
      textures = {};
      var i = 0;
      for (var name in shader.types.uniforms) {
        var t = shader.types.uniforms[name];
        if (t === "sampler2D") {
          textureUnits[name] = i;
          i ++;
        }
      }
    }

    function onContextLost () {
      if (shader) shader.dispose();
      shader = null;
    }

    function onContextRestored () {
      load();
    }

    function syncViewport () {
      var w = canvas.width, h = canvas.height;
      var x1 = 0, x2 = w, y1 = 0, y2 = h;
      if (currentShader) {
        currentShader.uniforms[RESOLUTION_UNIFORM] = new Float32Array([ w, h ]);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      shader.attributes.position.pointer();
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        x1, y1,
        x2, y1,
        x1, y2,
        x1, y2,
        x2, y1,
        x2, y2
      ]), gl.STATIC_DRAW);
      gl.viewport(x1, y1, x2, y2);
    }

    function setProgress (p) {
      shader.uniforms[PROGRESS_UNIFORM] = p;
    }

    function setUniform (name, value) {
      if (name in textureUnits) {
        var i = textureUnits[name];
        gl.activeTexture(gl.TEXTURE0 + i);

        var texture = textures[name];
        // Destroy the previous texture
        if (texture) texture.dispose();

        if (value === null) {
          // Texture is now a black texture
          textures[name] = texture = createTexture(gl, 2, 2);
        }
        else {
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          // Create a new texture
          textures[name] = texture = createTexture(gl, value);
        }

        shader.uniforms[name] = texture.bind(i);
      }
      else {
        shader.uniforms[name] = value;
      }
    }

    function reset () {
      var hasChanged = false;
      if (!shader) {
        load(); // Possibly shader was not loaded.
        hasChanged = true;
      }
      if (currentShader !== shader) {
        currentShader = shader;
        shader.bind();
        hasChanged = true;
      }
      syncViewport();
      return hasChanged;
    }

    function destroy () {
      if (currentShader === shader) {
        currentShader = null;
      }
      if (shader) {
        for (var t in textures) {
          textures[t].dispose();
        }
        textures = null;
        shader.dispose();
        shader = null;
      }
    }

    function getUniforms () {
      if (!shader) load();
      return extend({}, shader.types.uniforms);
    }

    var transition = {
      getGL: function () {
        return gl;
      },
      load: function () {
        // Possibly shader was not loaded.
        if (!shader) load();
      },
      bind: function () {
        // If shader has changed, we need to bind it
        if (currentShader !== shader) {
          currentShader = shader;
          if (!shader) load();
          shader.bind();
        }
      },
      isCurrentTransition: function () {
        return currentShader === shader;
      },
      onContextLost: onContextLost,
      onContextRestored: onContextRestored,
      syncViewport: syncViewport,
      setProgress: setProgress,
      setUniform: setUniform,
      reset: reset,
      draw: draw,
      destroy: destroy,
      getUniforms: getUniforms
    };

    transitions.push(transition);

    return transition;
  }

  createTransition.onContextLost = function (f) {
    userContextLostWatchers.push(f);
  };

  createTransition.getGL = function () {
    return gl;
  };

  // Finally init the GlslTransitionCore context
  init();

  return createTransition;
}

// DEPRECATED
GlslTransitionCore.defaults = {
  contextAttributes: { preserveDrawingBuffer: true }
};

// DEPRECATED
GlslTransitionCore.isSupported = function () {
  var c = document.createElement("canvas");
  return !!getWebGLContext(c);
};

module.exports = GlslTransitionCore;
