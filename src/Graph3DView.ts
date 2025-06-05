import Stats from 'stats.js'
import { ItemView, MetadataCache, WorkspaceLeaf } from "obsidian";
import * as THREE from "three";
import { ArcballControls } from 'three/addons/controls/ArcballControls.js';
import createLayout, { Layout } from 'ngraph.forcelayout';
import createGraph, { Graph, NodeId } from "ngraph.graph";


export const VIEW_TYPE_GRAPH3D = "graph-3d-view";

type GraphNode = { name: string, resolved: boolean };
type VaultGraph = Graph<GraphNode, number>;

class Graph3DLayout {
	nameToId: Map<string, NodeId>;
	graph: VaultGraph
	layout: Layout<VaultGraph>

	constructor() {
		this.nameToId = new Map();
		this.graph = createGraph();
		this.layout = createLayout(this.graph, {
			dimensions: 3,
			timeStep: 0.5,
			gravity: -1,
			theta: 0.8,
			springLength: 5,
			springCoefficient: 0.2,
			dragCoefficient: 0.8,
		});
	}

	createRandomGraph(numNodes: number, desiredAverageDegree = 0.59, allConnected = false) {
		for (let index = 0; index < numNodes; index++) { this.addOrGetNode({ name: index.toString(), resolved: true }) }

		// Critical parameter: average degree (determines percolation phase)
		const connectionProbability = desiredAverageDegree / (numNodes - 1);

		this.graph.forEachNode(source => {
			const count = this.graph.getLinkCount();
			this.graph.forEachNode(target => {
				if (source !== target && Math.random() < connectionProbability) {
					this.link(source.id, target.id);
				}
			});

			if (allConnected && this.graph.getLinkCount() - count === 0) {
				const targetId = Math.floor(Math.random() * numNodes);
				if (source.id !== targetId) { this.link(source.id, targetId) }
			}
		});

		return this;
	}

	fromMetadataCache(metadataCache: MetadataCache) {
		this.addLinks(metadataCache.resolvedLinks, true);
		this.addLinks(metadataCache.unresolvedLinks, false);
	}

	private addLinks(links: Record<string, Record<string, number>>, resolved: boolean) {
		for (const [sourceFile, targets] of Object.entries(links)) {
			const sourceId = this.addOrGetNode({ name: sourceFile, resolved: true });

			for (const [targetFile] of Object.entries(targets)) {
				const targetIndex = this.addOrGetNode({ name: targetFile, resolved });
				this.link(sourceId, targetIndex);
			}
		}
	}

	private addOrGetNode(node: GraphNode) {
		const cachedId = this.nameToId.get(node.name);
		if (cachedId !== undefined) {
			return cachedId;
		}

		const nodeId = this.graph.getNodeCount();
		this.graph.addNode(nodeId, node);
		this.nameToId.set(node.name, nodeId);

		return nodeId;
	}

	private link(sourceId: NodeId, targetIndex: NodeId) {
		this.graph.addLink(sourceId, targetIndex, 2 * this.graph.getLinkCount());
	}
}

export class Graph3DView extends ItemView {
	private animationFrameId: number;
	private renderer: THREE.WebGLRenderer;
	private layout: Graph3DLayout;
	private raycaster: THREE.Raycaster;
	private selectedNodeId: number | undefined = undefined;

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
		this.headerEl.style.background = "transparent";
		this.contentEl.empty();

		this.contentEl.style.padding = '0';
		this.contentEl.style.overflow = 'hidden';
		this.contentEl.style.position = 'relative';

		// Scene setup
		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(60, this.contentEl.clientWidth / this.contentEl.clientHeight, 0.1, 10000);
		camera.position.z = 200;

		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		this.renderer.setSize(this.contentEl.clientWidth, this.contentEl.clientHeight);
		this.renderer.shadowMap.enabled = true;

		this.containerEl.appendChild(this.renderer.domElement);
		this.renderer.domElement.style.width = "100%";
		this.renderer.domElement.style.height = "100%";
		this.renderer.domElement.style.position = "absolute";

		const controls = new ArcballControls(camera, this.renderer.domElement, scene);
		controls.cursorZoom = true;
		controls.setGizmosVisible(false);

		// Add raycaster for node selection
		this.raycaster = new THREE.Raycaster();

		// Graph generation
		this.layout = new Graph3DLayout();
		this.layout.fromMetadataCache(this.app.metadataCache);

		scene.add(new THREE.AmbientLight(0x808080));
		const light = new THREE.DirectionalLight(0xffffff, 1);
		light.position.set(5, 0, 0);
		scene.add(light);

		// Node and link visualization
		const sphereGeometry = new THREE.SphereGeometry(1, 16, 16);
		const sphereMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
		const instancedSpheres = new THREE.InstancedMesh(sphereGeometry, sphereMaterial, this.layout.graph.getNodeCount());

		// Give instances random colors
		this.layout.graph.forEachNode(node => {
			const color = node.data.resolved ? 0xffffff * Math.random() : 0x404040;
			instancedSpheres.setColorAt(node.id, new THREE.Color(color))
		});

		scene.add(instancedSpheres);

		const linkGeometry = new THREE.BufferGeometry();
		const positions = new Float32Array(this.layout.graph.getLinkCount() * 6); // 2 points per link, 3 coords per point
		linkGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

		const linkMaterial = new THREE.LineBasicMaterial({
			color: 0xa0a0a0,
			transparent: true,
			opacity: 0.6
		});

		const linkMesh = new THREE.LineSegments(linkGeometry, linkMaterial);
		scene.add(linkMesh);

		const stats = new Stats();
		stats.showPanel(0);
		stats.dom.style.position = 'absolute';
		stats.dom.style.top = '10px';
		stats.dom.style.right = '10px';
		stats.dom.style.left = 'auto';
		this.contentEl.appendChild(stats.dom);


		const labelCanvas = makeLabelCanvas(this.contentEl, this.layout.graph.getNode(0)?.data.name);
		const labelSprite = createLabelMesh(labelCanvas);
		scene.add(labelSprite);

		let downX: number | undefined;
		let downY: number | undefined;

		this.registerDomEvent(this.renderer.domElement, "pointerdown", (event) => {
			// Right click
			if (event.button === 0) {
				downX = event.clientX;
				downY = event.clientY;
			} else if (event.button === 2) {
				this.selectedNodeId = undefined;
			}
		})

		this.registerDomEvent(this.renderer.domElement, "pointerup", (event) => {
			if (event.clientX !== downX || event.clientY != downY) {
				downX = downY = undefined;
				return;
			}

			// Calculate pointer position in normalized device coordinates
			const rect = this.renderer.domElement.getBoundingClientRect();
			const pointerX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
			const pointerY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

			this.raycaster.setFromCamera(new THREE.Vector2(pointerX, pointerY), camera);
			const intersects = this.raycaster.intersectObject(instancedSpheres);

			if (intersects.length > 0) {
				const instanceId = intersects[0]?.instanceId;
				if (instanceId !== undefined) {
					this.selectedNodeId = instanceId;
					event.preventDefault();
				}
			}
		})

		// Animation loop
		const animate = () => {
			this.animationFrameId = requestAnimationFrame(animate);

			stats.begin();
			this.updateViewSize(this.renderer, camera);

			this.layout.layout.step();
			this.layout.layout.forEachBody((body, nodeId) => {
				const matrix = new THREE.Matrix4()
					.setPosition(body.pos.x, body.pos.y, body.pos.z ?? 0);

				instancedSpheres.setMatrixAt(nodeId, matrix)
			});

			// Set camera target
			if (this.selectedNodeId !== undefined) {
				const position = this.layout.layout.getNodePosition(this.selectedNodeId);
				controls.target.copy(position);
				controls.update();
			}

			instancedSpheres.count = this.layout.graph.getNodeCount();
			instancedSpheres.instanceMatrix.needsUpdate = true;
			instancedSpheres.computeBoundingSphere();

			const firstPos = this.layout.layout.getNodePosition(0);
			const nodePos = new THREE.Vector3(firstPos.x, firstPos.y, firstPos.z);

			const labelPos = nodePos;
			labelSprite.position.set(labelPos.x, labelPos.y, labelPos.z);

			const linePositionAttribute = linkGeometry.getAttribute('position') as THREE.BufferAttribute;
			this.layout.graph.forEachLink((link) => {
				const { from, to } = this.layout.layout.getLinkPosition(link.id);

				linePositionAttribute.setXYZ(link.data, from.x, from.y, from.z ?? 0);
				linePositionAttribute.setXYZ(link.data + 1, to.x, to.y, to.z ?? 0);
			});

			linePositionAttribute.needsUpdate = true
			linkGeometry.computeBoundingSphere();

			this.renderer.render(scene, camera);

			stats.end();
		};
		console.log(this);


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

function createLabelMesh(canvas: HTMLCanvasElement) {
	const texture = new THREE.CanvasTexture(canvas);
	texture.matrix.translate(10.5, 100);
	// texture.offset.set(0.5, 0);

	const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
	const sprite = new THREE.Sprite(material);
	sprite.scale.set(canvas.width / 100, canvas.height / 100, 1);
	sprite.center.set(0.5, -2.5);

	return sprite;
}

// Create a label for node
function makeLabelCanvas(container: Node, text: string) {
	const canvas = container.createEl("canvas", { cls: "graph-3d-node-canvas" });
	const ctx = canvas.getContext('2d')!;

	ctx.font = '48px sans-serif';
	const metrics = ctx.measureText(text);

	canvas.width = metrics.width + 20;
	canvas.height = 68;

	ctx.fillStyle = 'rgba(10,10,10,0.5)';
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	ctx.fillStyle = 'white';
	ctx.font = '48px sans-serif';
	ctx.fillText(text, 10, 58);

	canvas.style.visibility = "hidden";

	return canvas;
}
