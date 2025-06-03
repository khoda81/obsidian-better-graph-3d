import Stats from 'stats.js'
import { ItemView, WorkspaceLeaf } from "obsidian";
import * as THREE from "three";
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { forceSimulation, forceManyBody, forceLink, forceCenter } from 'd3-force-3d';

export const VIEW_TYPE_GRAPH3D = "graph-3d-view";

interface Node {
	id: number;
	x: number;
	y: number;
	z?: number;
}

export class Graph3DView extends ItemView {
	scene: THREE.Scene;
	controls: OrbitControls;
	camera: THREE.PerspectiveCamera;
	renderer: THREE.WebGLRenderer;
	animationFrameId: number;
	sim: any;

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
		if (!container) return;
		container.empty();

		const containerEl = container as HTMLElement;
		containerEl.style.padding = '0';
		containerEl.style.overflow = 'hidden';

		// Scene setup
		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 10000);
		this.camera.position.z = 1000;

		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		this.renderer.setSize(container.clientWidth, container.clientHeight);
		this.renderer.shadowMap.enabled = true;
		container.appendChild(this.renderer.domElement);
		this.renderer.domElement.style.width = "100%";
		this.renderer.domElement.style.height = "100%";

		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;

		this.scene.add(new THREE.AmbientLight(0x808080));
		const light = new THREE.DirectionalLight(0xffffff, 1);
		light.position.set(5, 0, 0);
		this.scene.add(light);

		// Graph generation
		const numNodes = 7000;
		const nodes: Node[] = Array.from({ length: numNodes }, (_, i) => ({ id: i }));
		const links: { source: number, target: number }[] = [];

		for (let i = 0; i < numNodes; i++) {
			for (let j = i + 1; j < numNodes; j++) {
				if (Math.random() < (2 / numNodes)) links.push({ source: i, target: j });
			}
		}

		// Node and link visualization
		const sphereGeometry = new THREE.SphereGeometry(10, 16, 16);
		const sphereMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
		const instancedSpheres = new THREE.InstancedMesh(sphereGeometry, sphereMaterial, numNodes);

		// Give instances random colors
		nodes.forEach((node, index) => instancedSpheres.setColorAt(index, new THREE.Color().setHex(0xffffff * Math.random())));

		this.scene.add(instancedSpheres);

		const mat = new THREE.LineBasicMaterial({ color: 0x606060 });
		const linkMeshes: THREE.Line[] = links.map(() => {
			const geo = new THREE.BufferGeometry().setFromPoints([
				new THREE.Vector3(), new THREE.Vector3()
			]);

			const line = new THREE.Line(geo, mat);
			return line;
		});

		const simId = Math.random();

		// FIX: Causes performance issues, put this in a web worker
		this.sim = forceSimulation(nodes, 3)
			.force("charge", forceManyBody().strength(-10))
			.force("link", forceLink(links).distance(50).strength(1.1))
			.force("center", forceCenter(0, 0, 0).strength(1))
			.alphaDecay(0.03)
			.alphaMin(0.1)
			.on("tick", () => {
				console.log(`Sim ${simId} is running`);

				// const dummy = new THREE.Object3D();
				nodes.forEach((node, i) => {
					const matrix = new THREE.Matrix4()
						.setPosition(node.x, node.y, node.z ?? 0);

					instancedSpheres.setMatrixAt(i, matrix)
				})

				instancedSpheres.count = nodes.length;
				instancedSpheres.instanceMatrix.needsUpdate = true;

				// links.forEach((link: any, i: number) => {
				// 	const src = link.source;
				// 	const tgt = link.target;
				// 	const line = linkMeshes[i];
				// 	const positions = line?.geometry.attributes.position as THREE.Float32BufferAttribute;
				// 	positions.setXYZ(0, src.x, src.y, src.z ?? 0);
				// 	positions.setXYZ(1, tgt.x, tgt.y, tgt.z ?? 0);
				// 	// console.log("Link positions", src, tgt, positions);
				// 	// positions[0] = src.x; positions[1] = src.y; positions[2] = src.z ?? 0;
				// 	// positions[3] = tgt.x; positions[4] = tgt.y; positions[5] = tgt.z ?? 0;
				// 	positions.needsUpdate = true;
				// });
			});

		this.register(() => this.sim.stop())

		console.log(this.sim);

		const stats = new Stats();
		stats.showPanel(0);
		stats.dom.style.position = 'absolute';
		stats.dom.style.top = '10px';
		stats.dom.style.right = '10px';
		container.appendChild(stats.dom);

		const clock = new THREE.Clock();
		// Animation loop
		const animate = () => {
			this.animationFrameId = requestAnimationFrame(animate);
			const delta = clock.getDelta();

			stats.begin();

			this.updateViewSize();
			this.controls.update(delta);
			this.renderer.render(this.scene, this.camera);

			stats.end();
		};

		// this.registerEvent()
		animate();
	}

	private updateViewSize() {
		const canvas = this.renderer.domElement;
		this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
		this.camera.updateProjectionMatrix();

		const width = canvas.clientWidth;
		const height = canvas.clientHeight;
		const needResize = canvas.width !== width || canvas.height !== height;
		if (needResize) {
			this.renderer.setSize(width, height, false);
		}

		return needResize;
	}

	async onClose() {
		cancelAnimationFrame(this.animationFrameId);
		this.renderer.dispose();
	}
}
