import Stats from 'stats.js'
import { ItemView, WorkspaceLeaf } from "obsidian";
import * as THREE from "three";
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export const VIEW_TYPE_GRAPH3D = "graph-3d-view";

export class Graph3DView extends ItemView {
	scene: THREE.Scene;
	controls: OrbitControls;
	camera: THREE.PerspectiveCamera;
	renderer: THREE.WebGLRenderer;
	animationFrameId: number;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE_GRAPH3D;
	}

	getDisplayText() {
		return "3D Graph View";
	}

	async onOpen() {
		const container = this.containerEl.children[1];

		if (!container) { return }
		container.empty();

		const containerEl = container as HTMLElement;

		// Remove container padding
		containerEl.style.padding = '0';
		containerEl.style.overflow = 'hidden';

		// Set up scene
		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
		this.camera.position.z = 5;

		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		this.renderer.setSize(container.clientWidth, container.clientHeight);
		container.appendChild(this.renderer.domElement);

		const light = new THREE.DirectionalLight(0xffffff, 1);
		light.position.set(5, 10, 7.5);
		light.castShadow = true;
		this.scene.add(light);

		this.scene.add(new THREE.AmbientLight(0x404040));
		this.renderer.shadowMap.enabled = true;

		// Add a test node (sphere)
		const geometry = new THREE.SphereGeometry(0.2, 128, 128);
		// const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2)
		const material = new THREE.MeshLambertMaterial({ color: 0x00ff00 });
		const sphere = new THREE.Mesh(geometry, material);
		this.scene.add(sphere);

		sphere.castShadow = true;
		sphere.receiveShadow = true;

		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;

		// Add render loop
		const animate = () => {
			this.animationFrameId = requestAnimationFrame(animate);
			stats.begin()

			this.controls.update();
			sphere.rotation.y += 0.01;
			this.renderer.render(this.scene, this.camera);

			stats.end();
		};

		const stats = new Stats();
		stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
		stats.dom.style.position = 'absolute';
		stats.dom.style.top = '10px';
		stats.dom.style.right = '10px';
		stats.dom.style.left = 'auto';
		container.appendChild(stats.dom)

		// Add resize listener
		this.onResize = () => {
			console.log("Resized to:", container.clientWidth, container.clientHeight);
			this.camera.aspect = container.clientWidth / container.clientHeight;
			this.camera.updateProjectionMatrix();
			this.renderer.setSize(container.clientWidth, container.clientHeight);
		};

		animate();
	}

	async onClose() {
		cancelAnimationFrame(this.animationFrameId);
		this.renderer.dispose();
	}
}
