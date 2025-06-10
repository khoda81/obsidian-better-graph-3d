import * as THREE from "three";

export class NodeLabel {
	labelFont = "48px sans-serif";

	text: string;
	canvas: HTMLCanvasElement;
	sprite: THREE.Sprite<THREE.Object3DEventMap>;

	static vertex = /* glsl */ `
	uniform float rotation;
	uniform vec2 center;
	
	#include <common>
	#include <uv_pars_vertex>
	#include <fog_pars_vertex>
	#include <logdepthbuf_pars_vertex>
	#include <clipping_planes_pars_vertex>
	
	varying float vDistance;
	
	void main() {
		#include <uv_vertex>
	
		vec4 mvPosition = modelViewMatrix[ 3 ];
	
		vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	
		#ifndef USE_SIZEATTENUATION
			bool isPerspective = isPerspectiveMatrix( projectionMatrix );
			if ( isPerspective ) scale *= - mvPosition.z;
		#endif
	
		vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	
		vec2 rotatedPosition;
		rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
		rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	
		mvPosition.xy += rotatedPosition;
	
		gl_Position = projectionMatrix * mvPosition;
	
		vDistance = length(mvPosition.xyz);
	
		#include <logdepthbuf_vertex>
		#include <clipping_planes_vertex>
		#include <fog_vertex>
	}
	`;

	static fragment = /* glsl */ `
	uniform vec3 diffuse;
	uniform float opacity;
	uniform float minDistance;
	uniform float maxDistance;
	
	#include <common>
	#include <uv_pars_fragment>
	#include <map_pars_fragment>
	#include <alphamap_pars_fragment>
	#include <alphatest_pars_fragment>
	#include <alphahash_pars_fragment>
	#include <fog_pars_fragment>
	#include <logdepthbuf_pars_fragment>
	#include <clipping_planes_pars_fragment>
	
	varying float vDistance;
	
	void main() {
		float distanceFactor = 1.0;
		if (maxDistance > minDistance) {
			distanceFactor = 1.0 - smoothstep(minDistance, maxDistance, vDistance);
			distanceFactor = max(distanceFactor, 0.0);
		}
	
		vec4 diffuseColor = vec4( diffuse, opacity * distanceFactor );
		#include <clipping_planes_fragment>
	
		vec3 outgoingLight = vec3( 0.0 );
	
		#include <logdepthbuf_fragment>
		#include <map_fragment>
		#include <alphamap_fragment>
		#include <alphatest_fragment>
		#include <alphahash_fragment>
	
		outgoingLight = diffuseColor.rgb;
	
		#include <opaque_fragment>
		#include <tonemapping_fragment>
		#include <colorspace_fragment>
		#include <fog_fragment>
	}
	`;

	constructor(text: string, minDistance = 10, maxDistance = 90) {
		this.canvas = document.createElement("canvas");
		this.canvas.className = "graph-3d-node-canvas";
		this.canvas.style.visibility = "hidden";

		const texture = new THREE.CanvasTexture(this.canvas);
		const material = new THREE.SpriteMaterial({
			map: texture,
			transparent: true,
			depthWrite: false,
		});

		material.onBeforeCompile = (shader) => {
			// Replace with our custom shaders
			shader.vertexShader = NodeLabel.vertex;
			shader.fragmentShader = NodeLabel.fragment;

			// Add the shared uniforms with default values
			shader.uniforms.minDistance = { value: minDistance };
			shader.uniforms.maxDistance = { value: maxDistance };

			console.log("Custom label shader compiled:", shader);
		};

		this.sprite = new THREE.Sprite(material);

		// Transform the sprite up
		this.sprite.center.set(0.5, -2.5);
		this.setText(text);
	}

	// Static method to update distance parameters for all labels
	setDistanceRange(minDistance: number, maxDistance: number) {
		(
			this.sprite.material as THREE.ShaderMaterial
		).uniforms.minDistance?.value = minDistance;
		(
			this.sprite.material as THREE.ShaderMaterial
		).uniforms.maxDistance.value = maxDistance;
	}

	setText(text: string) {
		if (this.text === text) {
			return;
		}
		const ctx = this.canvas.getContext("2d");

		if (!ctx) {
			console.error(`Could not get 2D context for ${this.canvas}`);
			return;
		}

		// We need to create a separate texture therefore canvas for each label
		ctx.font = this.labelFont;
		const metrics = ctx.measureText(text);

		this.canvas.width = metrics.width + 20;
		this.canvas.height = 68;

		ctx.fillStyle = "rgba(10, 10, 10, 0.5)";
		ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

		ctx.fillStyle = "white";
		ctx.font = this.labelFont;
		ctx.fillText(text, 10, 58);

		// Scale down the sprite by a factor of 100
		this.sprite.scale.set(
			this.canvas.width / 100,
			this.canvas.height / 100,
			1,
		);
		this.text = text;
	}

	dispose() {
		this.canvas.remove();
		this.sprite.removeFromParent();
		this.sprite.material.dispose();
	}
}
