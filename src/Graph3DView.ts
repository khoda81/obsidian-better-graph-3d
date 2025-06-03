import Stats from 'stats.js'
import { ItemView, WorkspaceLeaf } from "obsidian";
import * as THREE from "three";
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { forceSimulation, forceManyBody, forceLink, forceCenter } from 'd3-force-3d';

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
		if (!container) return;
		container.empty();

		const containerEl = container as HTMLElement;
		containerEl.style.padding = '0';
		containerEl.style.overflow = 'hidden';

		// Scene setup
		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 10000);
		this.camera.position.z = 300;

		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		this.renderer.setSize(container.clientWidth, container.clientHeight);
		this.renderer.shadowMap.enabled = true;
		container.appendChild(this.renderer.domElement);


		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;

		this.scene.add(new THREE.AmbientLight(0x808080));
		const light = new THREE.DirectionalLight(0xffffff, 1);
		light.position.set(5, 10, 7.5);
		this.scene.add(light);

		// Graph generation
		const numNodes = 200;
		const nodes = Array.from({ length: numNodes }, (_, i) => ({ id: i }));
		const links: { source: number, target: number }[] = [];

		for (let i = 0; i < numNodes; i++) {
			for (let j = i + 1; j < numNodes; j++) {
				if (Math.random() < (2 / numNodes)) links.push({ source: i, target: j });
			}
		}

		// Node and link visualization
		const nodeMeshes: THREE.Mesh[] = [];

		const geo = new THREE.SphereGeometry(10, 32, 32);
		nodes.forEach(() => {
			const mat = new THREE.MeshLambertMaterial({ color: 0xffffff * Math.random() });
			const mesh = new THREE.Mesh(geo, mat);
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			this.scene.add(mesh);
			nodeMeshes.push(mesh);
		});

		const mat = new THREE.LineBasicMaterial({ color: 0x606060 });
		const linkMeshes: THREE.Line[] = links.map(() => {
			const geo = new THREE.BufferGeometry().setFromPoints([
				new THREE.Vector3(), new THREE.Vector3()
			]);
			const line = new THREE.Line(geo, mat);
			this.scene.add(line);
			return line;
		});

		const sim = forceSimulation(nodes, 3)
			.force("charge", forceManyBody().strength(-10))
			.force("link", forceLink(links).distance(50).strength(1.1))
			.force("center", forceCenter(0, 0, 0).strength(1))
			.alphaDecay(0.003)
			.alphaMin(0.0)
			.on("tick", () => {
				// console.log("Simulation tick");
				nodes.forEach((node: any, i: number) => {
					nodeMeshes[i].position.set(node.x, node.y, node.z ?? 0);
				});


				links.forEach((link: any, i: number) => {
					const src = link.source;
					const tgt = link.target;
					const line = linkMeshes[i];
					const positions = line?.geometry.attributes.position as THREE.Float32BufferAttribute;
					positions.setXYZ(0, src.x, src.y, src.z ?? 0);
					positions.setXYZ(1, tgt.x, tgt.y, tgt.z ?? 0);
					// console.log("Link positions", src, tgt, positions);
					// positions[0] = src.x; positions[1] = src.y; positions[2] = src.z ?? 0;
					// positions[3] = tgt.x; positions[4] = tgt.y; positions[5] = tgt.z ?? 0;
					positions.needsUpdate = true;
				});
			});

		console.log(sim);

		const stats = new Stats();
		stats.showPanel(2);
		stats.dom.style.position = 'absolute';
		stats.dom.style.top = '10px';
		stats.dom.style.right = '10px';
		container.appendChild(stats.dom);

		// Resize support
		this.onResize = () => {
			this.camera.aspect = container.clientWidth / container.clientHeight;
			this.camera.updateProjectionMatrix();
			this.renderer.setSize(container.clientWidth, container.clientHeight);
		};

		// Animation loop
		const animate = () => {
			this.animationFrameId = requestAnimationFrame(animate);
			stats.begin();
			this.controls.update();
			this.renderer.render(this.scene, this.camera);
			console.log(this.renderer.info.render.calls); // Inside your animation loop

			stats.end();
		};
		animate();
	}

	async onClose() {
		cancelAnimationFrame(this.animationFrameId);
		this.renderer.dispose();
	}
}
