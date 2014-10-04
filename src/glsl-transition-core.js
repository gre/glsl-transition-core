var createShader = require("gl-shader-core");
var createTexture = require("gl-texture2d");
var glslExports = require("glsl-exports");

var VERTEX_SHADER = 'attribute vec2 p;varying vec2 texCoord;void main(){gl_Position=vec4(2.*p-1.,0.,1.);texCoord=p;}';
var VERTEX_TYPES = glslExports(VERTEX_SHADER);
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

  /*
  function createTexture () {
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }
  */

  /*
  function syncTexture (texture, image) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (image) {
      if (typeof image === "function") {
        // This allows everything. It is a workaround to define non Image/Canvas/Video textures like using Array.
        // We may use gl-texture2d in the future but it brings more deps to the project
        image(gl);
      }
      else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      }
    }
    else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
  }
  */

  function loadTransitionShader (glsl, glslTypes) {
    var uniformsByName = extend({}, glslTypes.uniforms, VERTEX_TYPES.uniforms);
    var attributesByName = extend({}, glslTypes.attributes, VERTEX_TYPES.attributes);
    var name;
    var uniforms = [];
    var attributes = [];
    for (name in uniformsByName) {
      uniforms.push({ name: name, type: uniformsByName[name] });
    }
    for (name in attributesByName) {
      attributes.push({ name: name, type: attributesByName[name] });
    }
    var shader = createShader(gl, VERTEX_SHADER, glsl, uniforms, attributes);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    shader.attributes.p.pointer();
    return shader;
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
    var glslTypes = glslExports(glsl);

    // Second level variables
    var shader, textureUnits, textures;

    function load () {
      if (!gl) return;
      shader = loadTransitionShader(glsl, glslTypes);
      textureUnits = {};
      textures = {};
      var i = 0;
      for (var name in glslTypes.uniforms) {
        var t = glslTypes.uniforms[name];
        if (t === "sampler2D") {
          //gl.activeTexture(gl.TEXTURE0 + i);
          textureUnits[name] = i;
          //textures[name] = createTexture();
          i ++;
        }
      }
    }

    function onContextLost () {
      shader = null;
    }

    function onContextRestored () {
      load();
    }

    function syncViewport () {
      var w = canvas.width, h = canvas.height;
      gl.viewport(0, 0, w, h);
      if (currentShader) {
        currentShader.uniforms[RESOLUTION_UNIFORM] = new Float32Array([ w, h ]);
      }
      var x1 = 0, x2 = w, y1 = 0, y2 = h;
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        x1, y1,
        x2, y1,
        x1, y2,
        x1, y2,
        x2, y1,
        x2, y2
      ]), gl.STATIC_DRAW);
    }

    function setProgress (p) {
      shader.uniforms[PROGRESS_UNIFORM] = p;
      // console.log(Object.keys(shader.uniforms).map(function(key){ return key+": "+shader.uniforms[key]; }).join(" "));
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
          // Create a new texture
          textures[name] = texture = createTexture(gl, value);
        }

        shader.uniforms[name] = texture.bind(i);

        /*
        var texture = textures[name];
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        syncTexture(texture, value);
        shader.uniforms[name] = i;
        */
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
      return extend({}, glslTypes.uniforms);
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

GlslTransitionCore.defaults = {
  contextAttributes: { preserveDrawingBuffer: true }
};

GlslTransitionCore.isSupported = function () {
  var c = document.createElement("canvas");
  return !!getWebGLContext(c);
};

module.exports = GlslTransitionCore;
