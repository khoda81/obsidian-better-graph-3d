import Stats from 'stats.js'
import { ItemView, WorkspaceLeaf } from "obsidian";
import * as THREE from "three";
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import createLayout from 'ngraph.forcelayout';
import createGraph from "ngraph.graph";


export const VIEW_TYPE_GRAPH3D = "graph-3d-view";


export class Graph3DView extends ItemView {
	animationFrameId: number;
	renderer: THREE.WebGLRenderer
	layout: any

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
		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 100000);
		camera.position.z = 1000;

		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		this.renderer.setSize(container.clientWidth, container.clientHeight);
		this.renderer.shadowMap.enabled = true;
		container.appendChild(this.renderer.domElement);
		this.renderer.domElement.style.width = "100%";
		this.renderer.domElement.style.height = "100%";

		const controls = new OrbitControls(camera, this.renderer.domElement);
		controls.enableDamping = true;

		// Graph generation
		const numNodes = 1000;
		const graph = createGraph();

		for (let index = 0; index < numNodes; index++) { graph.addNode(index) }

		// Critical parameter: average degree (determines percolation phase)
		const desiredAverageDegree = 0.59; // Example value (adjust as needed)
		const connectionProbability = desiredAverageDegree / (numNodes - 1);

		let linkIdx = 0;
		graph.forEachNode(source => {
			const count = graph.getLinkCount();
			graph.forEachNode(target => {
				if (source !== target && Math.random() < connectionProbability) {
					graph.addLink(source.id, target.id, linkIdx);
					linkIdx += 2;
				}
			});

			// if (graph.getLinkCount() - count === 0) {
			// 	const targetId = Math.floor(Math.random() * numNodes);
			// 	if (source.id !== targetId) {
			// 		graph.addLink(source.id, targetId, linkIdx);
			// 		linkIdx += 2;
			// 	}
			// }
		})

		scene.add(new THREE.AmbientLight(0x808080));
		const light = new THREE.DirectionalLight(0xffffff, 1);
		light.position.set(5, 0, 0);
		scene.add(light);

		// Node and link visualization
		const sphereGeometry = new THREE.SphereGeometry(3, 16, 16);
		const sphereMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
		const instancedSpheres = new THREE.InstancedMesh(sphereGeometry, sphereMaterial, numNodes);

		// Give instances random colors
		graph.forEachNode(node => instancedSpheres.setColorAt(node.id, new THREE.Color().setHex(0xffffff * Math.random())));
		console.log(instancedSpheres);

		scene.add(instancedSpheres);

		const linkGeometry = new THREE.BufferGeometry();

		// const linkIndices = new Array(links.length * 2);
		// links.forEach((link, i) => {
		// 	linkIndices[i * 2] = link.source;
		// 	linkIndices[i * 2 + 1] = link.target;
		// });
		// // const linkIndices = links.flatMap(link => [link.source, link.target]);
		// // const linkIndices = /* pairs of indices of src and tgt for each link */;

		// linkGeometry.setIndex(linkIndices);
		// linkGeometry.setAttribute('position', sphereGeometry.attributes.position);

		const positions = new Float32Array(graph.getLinkCount() * 6); // 2 points per link, 3 coords per point
		linkGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

		const linkMaterial = new THREE.LineBasicMaterial({
			color: 0xa0a0a0,
			transparent: true,
			opacity: 0.6
		});

		const linkMesh = new THREE.LineSegments(linkGeometry, linkMaterial);
		scene.add(linkMesh);

		// // FIX: Doing this in the main thread causes performance issues,
		// // put this in a web worker
		// this.sim = forceSimulation(nodes, 3)
		// 	.force("charge", forceManyBody().strength(-50))
		// 	.force("link", forceLink(links).distance(20).strength(1.1))
		// 	.force("center", forceCenter(0, 0, 0).strength(1))
		// 	.alphaDecay(0.003)
		// 	.alphaMin(0.01);

		this.layout = createLayout(graph, {
			dimensions: 3,
			timeStep: 0.5,
			gravity: -52,
			theta: 0.8,
			springLength: 10,
			springCoefficient: 0.8,
			dragCoefficient: 0.2,
		});

		console.log(this.layout);

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

			this.layout.step();

			// console.log(`Sim ${simId} is running, alpha: ${this.layout.alpha()}`);

			// const dummy = new THREE.Object3D();
			graph.forEachNode((node) => {
				const position = this.layout.getNodePosition(node.id);
				// console.log(node, position);
				const matrix = new THREE.Matrix4()
					.setPosition(position.x, position.y, position.z ?? 0);

				instancedSpheres.setMatrixAt(node.id, matrix)
			})

			instancedSpheres.count = graph.getNodeCount();
			instancedSpheres.instanceMatrix.needsUpdate = true;

			const linePositionAttribute = linkGeometry.getAttribute('position') as THREE.BufferAttribute;
			graph.forEachLink((link) => {
				// const source = this.layout.getNodePosition(link.fromId);
				// const target = this.layout.getNodePosition(link.toId);
				const { from, to } = this.layout.getLinkPosition(link.id);

				linePositionAttribute.setXYZ(link.data, from.x, from.y, from.z ?? 0);
				linePositionAttribute.setXYZ(link.data + 1, to.x, to.y, to.z ?? 0);
			});

			linePositionAttribute.needsUpdate = true

			linkGeometry

			this.updateViewSize(this.renderer, camera);
			controls.update(delta);
			this.renderer.render(scene, camera);


			stats.end();
		};

		// this.registerEvent()
		animate();
	}

	private updateViewSize(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
		const canvas = renderer.domElement;
		camera.aspect = canvas.clientWidth / canvas.clientHeight;
		camera.updateProjectionMatrix();

		const width = canvas.clientWidth;
		const height = canvas.clientHeight;
		const needResize = canvas.width !== width || canvas.height !== height;
		if (needResize) {
			renderer.setSize(width, height, false);
		}

		return needResize;
	}

	async onClose() {
		cancelAnimationFrame(this.animationFrameId);
		this.renderer.dispose();
	}
}
