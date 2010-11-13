function UnitAI() {}

UnitAI.prototype.Schema =
	"<a:help>Controls the unit's movement, attacks, etc, in response to commands from the player.</a:help>" +
	"<a:example/>" +
	"<element name='FormationController'>" +
		"<data type='boolean'/>" +
	"</element>";

// Very basic stance support (currently just for test maps where we don't want
// everyone killing each other immediately after loading)
var g_Stances = {
	"aggressive": {
		attackOnSight: true,
	},
	"holdfire": {
		attackOnSight: false,
	},
};

var UnitFsmSpec = {

	// Default event handlers:

	"MoveCompleted": function() {
		// ignore spurious movement messages
		// (these can happen when stopping moving at the same time
		// as switching states)
	},

	"MoveStarted": function() {
		// ignore spurious movement messages
	},

	"ConstructionFinished": function(msg) {
		// ignore uninteresting construction messages
	},

	"LosRangeUpdate": function(msg) {
		// ignore newly-seen units by default
	},

	"Attacked": function(msg) {
		// ignore attacker
	},


	// Formation handlers:

	"FormationLeave": function(msg) {
		// ignore when we're not in FORMATIONMEMBER
	},

	// Called when being told to walk as part of a formation
	"Order.FormationWalk": function(msg) {
		var cmpUnitMotion = Engine.QueryInterface(this.entity, IID_UnitMotion);
		cmpUnitMotion.MoveToFormationOffset(msg.data.target, msg.data.x, msg.data.z);

		this.SetNextState("FORMATIONMEMBER.WALKING");
	},


	// Individual orders:
	// (these will switch the unit out of formation mode)

	"Order.Walk": function(msg) {
		this.MoveToPoint(this.order.data.x, this.order.data.z);
		this.SetNextState("INDIVIDUAL.WALKING");
	},

	"Order.WalkToTarget": function(msg) {
		var ok = this.MoveToTarget(this.order.data.target);
		if (ok)
		{
			// We've started walking to the given point
			this.SetNextState("INDIVIDUAL.WALKING");
		}
		else
		{
			// We are already at the target, or can't move at all
			this.FinishOrder();
		}
	},

	"Order.Attack": function(msg) {
		// Check the target is alive
		if (!this.TargetIsAlive(this.order.data.target))
		{
			this.FinishOrder();
			return;
		}

		// Work out how to attack the given target
		var type = this.GetBestAttack();
		if (!type)
		{
			// Oops, we can't attack at all
			this.FinishOrder();
			return;
		}
		this.attackType = type;

		// Try to move within attack range
		if (this.MoveToTargetRange(this.order.data.target, IID_Attack, this.attackType))
		{
			// We've started walking to the given point
			this.SetNextState("INDIVIDUAL.COMBAT.APPROACHING");
		}
		else
		{
			// We are already at the target, or can't move at all,
			// so try attacking it from here.
			// TODO: need better handling of the can't-reach-target case
			this.SetNextState("INDIVIDUAL.COMBAT.ATTACKING");
		}
	},

	"Order.Gather": function(msg) {
		// If the target is still alive, we need to kill it first
		if (this.MustKillGatherTarget(this.order.data.target))
		{
			// Make sure we can attack the target, else we'll get very stuck
			if (!this.GetBestAttack())
			{
				// Oops, we can't attack at all - give up
				// TODO: should do something so the player knows why this failed
				this.FinishOrder();
				return;
			}

			this.PushOrderFront("Attack", { "target": this.order.data.target });
			return;
		}

		// Try to move within range
		if (this.MoveToTargetRange(this.order.data.target, IID_ResourceGatherer))
		{
			// We've started walking to the given point
			this.SetNextState("INDIVIDUAL.GATHER.APPROACHING");
		}
		else
		{
			// We are already at the target, or can't move at all,
			// so try gathering it from here.
			// TODO: need better handling of the can't-reach-target case
			this.SetNextState("INDIVIDUAL.GATHER.GATHERING");
		}
	},
	
	"Order.Repair": function(msg) {
		// Try to move within range
		if (this.MoveToTargetRange(this.order.data.target, IID_Builder))
		{
			// We've started walking to the given point
			this.SetNextState("INDIVIDUAL.REPAIR.APPROACHING");
		}
		else
		{
			// We are already at the target, or can't move at all,
			// so try repairing it from here.
			// TODO: need better handling of the can't-reach-target case
			this.SetNextState("INDIVIDUAL.REPAIR.REPAIRING");
		}
	},
	
	"Order.Garrison": function(msg) {
		if (this.MoveToTarget(this.order.data.target))
		{
			this.SetNextState("INDIVIDUAL.GARRISON.APPROACHING");
		}
		else
		{
			this.SetNextState("INDIVIDUAL.GARRISON.GARRISONED");
		}
	},

	// States for the special entity representing a group of units moving in formation:
	"FORMATIONCONTROLLER": {

		"Order.Walk": function(msg) {
			this.MoveToPoint(this.order.data.x, this.order.data.z);
			this.SetNextState("WALKING");
		},

		"Order.Attack": function(msg) {
			// TODO: we should move in formation towards the target,
			// then break up into individuals when close enough to it

			var cmpFormation = Engine.QueryInterface(this.entity, IID_Formation);
			cmpFormation.CallMemberFunction("Attack", [msg.data.target, false]);

			// TODO: we should wait until the target is killed, then
			// move on to the next queued order.
			// Don't bother now, just disband the formation immediately.
			cmpFormation.Disband();
		},

		"Order.Repair": function(msg) {
			// TODO: see notes in Order.Attack
			var cmpFormation = Engine.QueryInterface(this.entity, IID_Formation);
			cmpFormation.CallMemberFunction("Repair", [msg.data.target, false]);
			cmpFormation.Disband();
		},

		"Order.Gather": function(msg) {
			// TODO: see notes in Order.Attack
			var cmpFormation = Engine.QueryInterface(this.entity, IID_Formation);
			cmpFormation.CallMemberFunction("Gather", [msg.data.target, false]);
			cmpFormation.Disband();
		},

		"IDLE": {
			"enter": function() {
				this.SelectAnimation("idle");
			},
		},

		"WALKING": {
			"MoveStarted": function(msg) {
				var cmpFormation = Engine.QueryInterface(this.entity, IID_Formation);
				cmpFormation.MoveMembersIntoFormation(true);
			},

			"MoveCompleted": function(msg) {
				if (this.FinishOrder())
					return;

				var cmpFormation = Engine.QueryInterface(this.entity, IID_Formation);
				cmpFormation.Disband();
			},
		},
	},


	// States for entities moving as part of a formation:
	"FORMATIONMEMBER": {

		"FormationLeave": function(msg) {
			this.SetNextState("INDIVIDUAL.IDLE");
		},

		"IDLE": {
			"enter": function() {
				this.SelectAnimation("idle");
			},
		},

		"WALKING": {
			"enter": function () {
				this.SelectAnimation("move");
			},
		},
	},


	// States for entities not part of a formation:
	"INDIVIDUAL": {

		"Attacked": function(msg) {
			// Default behaviour: attack back at our attacker
			if (this.CanAttack(msg.data.attacker))
			{
				this.PushOrderFront("Attack", { "target": msg.data.attacker });
			}
			else
			{	// TODO: If unit can't attack, run away
			}
		},

		"IDLE": {
			"enter": function() {
				// If we entered the idle state we must have nothing better to do,
				// so immediately check whether there's anybody nearby to attack.
				// (If anyone approaches later, it'll be handled via LosRangeUpdate.)
				if (this.losRangeQuery)
				{
					var rangeMan = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
					var ents = rangeMan.ResetActiveQuery(this.losRangeQuery);
					if (this.GetStance().attackOnSight && this.AttackVisibleEntity(ents))
						return true;
				}

				// Nobody to attack - switch to idle
				this.SelectAnimation("idle");
				return false;
			},

			"leave": function() {
				var rangeMan = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
				rangeMan.DisableActiveQuery(this.losRangeQuery);
			},

			"LosRangeUpdate": function(msg) {
				if (this.GetStance().attackOnSight)
				{
					// Start attacking one of the newly-seen enemy (if any)
					this.AttackVisibleEntity(msg.data.added);
				}
			},
		},

		"WALKING": {
			"enter": function () {
				this.SelectAnimation("move");
			},

			"MoveCompleted": function() {
				this.FinishOrder();
			},
		},

		"COMBAT": {
			"Attacked": function(msg) {
				// If we're already in combat mode, ignore anyone else
				// who's attacking us
			},

			"APPROACHING": {
				"enter": function () {
					this.SelectAnimation("move");
				},

				"MoveCompleted": function() {
					this.SetNextState("ATTACKING");
				},
			},

			"ATTACKING": {
				"enter": function() {
					var cmpAttack = Engine.QueryInterface(this.entity, IID_Attack);
					this.attackTimers = cmpAttack.GetTimers(this.attackType);

					this.SelectAnimation("melee", false, 1.0, "attack");
					this.SetAnimationSync(this.attackTimers.prepare, this.attackTimers.repeat);
					this.StartTimer(this.attackTimers.prepare, this.attackTimers.repeat);
					// TODO: we should probably only bother syncing projectile attacks, not melee

					// TODO: if .prepare is short, players can cheat by cycling attack/stop/attack
					// to beat the .repeat time; should enforce a minimum time
				},

				"leave": function() {
					this.StopTimer();
				},

				"Timer": function(msg) {
					// Check the target is still alive
					if (this.TargetIsAlive(this.order.data.target))
					{
						// Check we can still reach the target
						if (this.CheckTargetRange(this.order.data.target, IID_Attack, this.attackType))
						{
							var cmpAttack = Engine.QueryInterface(this.entity, IID_Attack);
							cmpAttack.PerformAttack(this.attackType, this.order.data.target);
							return;
						}

						// Can't reach it - try to chase after it
						if (this.MoveToTargetRange(this.order.data.target, IID_Attack, this.attackType))
						{
							this.SetNextState("COMBAT.CHASING");
							return;
						}
					}

					// Can't reach it, or it doesn't exist any more - give up
					this.FinishOrder();
							
					// TODO: see if we can switch to a new nearby enemy
				},

				// TODO: respond to target deaths immediately, rather than waiting
				// until the next Timer event
			},

			"CHASING": {
				"enter": function () {
					this.SelectAnimation("move");
				},
			
				"MoveCompleted": function() {
					this.SetNextState("ATTACKING");
				},
			},
		},

		"GATHER": {
			"APPROACHING": {
				"enter": function () {
					this.SelectAnimation("move");
				},

				"MoveCompleted": function() {
					this.SetNextState("GATHERING");
				},
			},

			"GATHERING": {
				"enter": function() {
					var typename = "gather_" + this.order.data.type.specific;
					this.SelectAnimation(typename, false, 1.0, typename);
					this.StartTimer(1000, 1000);
				},

				"leave": function() {
					this.StopTimer();
				},

				"Timer": function(msg) {
					// Check we can still reach the target
					if (this.CheckTargetRange(this.order.data.target, IID_ResourceGatherer))
					{
						var cmpResourceGatherer = Engine.QueryInterface(this.entity, IID_ResourceGatherer);
						var status = cmpResourceGatherer.PerformGather(this.order.data.target);
					}
					else
					{
						// Try to follow it
						if (this.MoveToTargetRange(this.order.data.target, IID_ResourceGatherer))
						{
							this.SetNextState("APPROACHING");
						}
						else
						{
							// Save the current order's type in case we need it later
							var oldType = this.order.data.type;

							// Can't reach it, or it doesn't exist any more - give up on this order
							if (this.FinishOrder())
								return;

							// No remaining orders - pick a useful default behaviour

							// Try to find a nearby target of the same type

							var range = 64; // TODO: what's a sensible number?

							// Accept any resources owned by Gaia
							var players = [0];
							// Also accept resources owned by this unit's player:
							var cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
							if (cmpOwnership)
								players.push(cmpOwnership.GetOwner());

							var rangeMan = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
							var nearby = rangeMan.ExecuteQuery(this.entity, range, players, IID_ResourceSupply);
							for each (var ent in nearby)
							{
								var cmpResourceSupply = Engine.QueryInterface(ent, IID_ResourceSupply);
								var type = cmpResourceSupply.GetType();
								if (type.specific == oldType.specific)
								{
									this.Gather(ent, true);
									return;
								}
							}

							// Nothing else to gather - just give up
						}
					}
				},
			},
		},

		"REPAIR": {
			"APPROACHING": {
				"enter": function () {
					this.SelectAnimation("move");
				},
			
				"MoveCompleted": function() {
					this.SetNextState("REPAIRING");
				},
			},

			"REPAIRING": {
				"enter": function() {
					this.SelectAnimation("build", false, 1.0, "build");
					this.StartTimer(1000, 1000);
				},

				"leave": function() {
					this.StopTimer();
				},

				"Timer": function(msg) {
					var target = this.order.data.target;
					// Check we can still reach the target
					if (!this.CheckTargetRange(target, IID_Builder))
					{
						// Can't reach it, or it doesn't exist any more
						this.FinishOrder();
						return;
					}
					
					var cmpBuilder = Engine.QueryInterface(this.entity, IID_Builder);
					cmpBuilder.PerformBuilding(target);
				},
			},

			"ConstructionFinished": function(msg) {
				if (msg.data.entity != this.order.data.target)
					return; // ignore other buildings

				// We finished building it.
				// Switch to the next order (if any)
				if (this.FinishOrder())
					return;

				// No remaining orders - pick a useful default behaviour

				// If this building was e.g. a farm, we should start gathering from it
				// if we are capable of doing so
				if (this.CanGather(msg.data.newentity))
				{
					this.Gather(msg.data.newentity, true);
				}
				else
				{
					// TODO: look for a nearby foundation to help with
				}
			},
		},

		"GARRISON": {
			"APPROACHING": {
				"enter": function() {
					this.SelectAnimation("walk", false, this.GetWalkSpeed());
					this.PlaySound("walk");
				},

				"MoveCompleted": function() {
					this.SetNextState("GARRISONED");
				},
				
				"leave": function() {
					this.StopTimer();
				}
			},

			"GARRISONED": {
				"enter": function() {
					var cmpGarrisonHolder = Engine.QueryInterface(this.order.data.target, IID_GarrisonHolder);
					if (cmpGarrisonHolder)
					{
						cmpGarrisonHolder.Garrison(this.entity);
						
					}
					if (this.FinishOrder())
						return;
				},

				"leave": function() {

				}
			},
		},

	},
};

var UnitFsm = new FSM(UnitFsmSpec);

UnitAI.prototype.Init = function()
{
	this.orderQueue = []; // current order is at the front of the list
	this.order = undefined; // always == this.orderQueue[0]
	this.formationController = INVALID_ENTITY; // entity with IID_Formation that we belong to

	this.SetStance("aggressive");
};

UnitAI.prototype.IsFormationController = function()
{
	return (this.template.FormationController == "true");
};

UnitAI.prototype.OnCreate = function()
{
	if (this.IsFormationController())
		UnitFsm.Init(this, "FORMATIONCONTROLLER.IDLE");
	else
		UnitFsm.Init(this, "INDIVIDUAL.IDLE");
};

UnitAI.prototype.OnOwnershipChanged = function(msg)
{
	this.SetupRangeQuery(msg.to);
};

UnitAI.prototype.OnDestroy = function()
{
	// Clean up any timers that are now obsolete
	this.StopTimer();

	// Clean up range queries
	var rangeMan = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	if (this.losRangeQuery)
		rangeMan.DestroyActiveQuery(this.losRangeQuery);
};

// Set up a range query for all enemy units within LOS range
// which can be attacked.
// This should be called whenever our ownership changes.
UnitAI.prototype.SetupRangeQuery = function(owner)
{
	var cmpVision = Engine.QueryInterface(this.entity, IID_Vision);
	if (!cmpVision)
		return;
	
	var rangeMan = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	var playerMan = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
	
	if (this.losRangeQuery)
		rangeMan.DestroyActiveQuery(this.losRangeQuery);

	var range = cmpVision.GetRange();
	
	var players = [];
	
	if(owner != -1)
	{	// If unit not just killed, get enemy players via diplomacy
		var player = Engine.QueryInterface(playerMan.GetPlayerByID(owner), IID_Player);

		// Get our diplomacy array
		var diplomacy = player.GetDiplomacy();
		var numPlayers = playerMan.GetNumPlayers();
		
		for (var i = 1; i < numPlayers; ++i)
		{	// Exclude gaia, allies, and self
			// TODO: How to handle neutral players - Special query to attack military only?
			if (i != owner && diplomacy[i - 1] < 0)
				players.push(i);
		}
	}
	
	this.losRangeQuery = rangeMan.CreateActiveQuery(this.entity, range, players, IID_DamageReceiver);
	rangeMan.EnableActiveQuery(this.losRangeQuery);
};

//// FSM linkage functions ////

UnitAI.prototype.SetNextState = function(state)
{
	UnitFsm.SetNextState(this, state);
};

UnitAI.prototype.DeferMessage = function(msg)
{
	UnitFsm.DeferMessage(this, msg);
};

/**
 * Call when the current order has been completed (or failed).
 * Removes the current order from the queue, and processes the
 * next one (if any). Returns false and defaults to IDLE
 * if there are no remaining orders.
 */
UnitAI.prototype.FinishOrder = function()
{
	if (!this.orderQueue.length)
		error("FinishOrder called when order queue is empty");

	this.orderQueue.shift();
	this.order = this.orderQueue[0];

	if (this.orderQueue.length)
	{
		UnitFsm.ProcessMessage(this, {"type": "Order."+this.order.type, "data": this.order.data});
		return true;
	}
	else
	{
		this.SetNextState("IDLE");
		return false;
	}
};

/**
 * Add an order onto the back of the queue,
 * and execute it if we didn't already have an order.
 */
UnitAI.prototype.PushOrder = function(type, data)
{
	var order = { "type": type, "data": data };
	this.orderQueue.push(order);

	// If we didn't already have an order, then process this new one
	if (this.orderQueue.length == 1)
	{
		this.order = order;
		UnitFsm.ProcessMessage(this, {"type": "Order."+this.order.type, "data": this.order.data});
	}
};

/**
 * Add an order onto the front of the queue,
 * and execute it immediately.
 */
UnitAI.prototype.PushOrderFront = function(type, data)
{
	var order = { "type": type, "data": data };
	this.orderQueue.unshift(order);

	this.order = order;
	UnitFsm.ProcessMessage(this, {"type": "Order."+this.order.type, "data": this.order.data});
};

UnitAI.prototype.ReplaceOrder = function(type, data)
{
	this.orderQueue = [];
	this.PushOrder(type, data);
};

UnitAI.prototype.TimerHandler = function(data, lateness)
{
	// Reset the timer
	var cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	this.timer = cmpTimer.SetTimeout(this.entity, IID_UnitAI, "TimerHandler", data.timerRepeat - lateness, data);

	UnitFsm.ProcessMessage(this, {"type": "Timer", "data": data, "lateness": lateness});
};

UnitAI.prototype.StartTimer = function(offset, repeat)
{
	if (this.timer)
		error("Called StartTimer when there's already an active timer");

	var cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	this.timer = cmpTimer.SetTimeout(this.entity, IID_UnitAI, "TimerHandler", offset, { "timerRepeat": repeat });
};

UnitAI.prototype.StopTimer = function()
{
	if (!this.timer)
		return;

	var cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	cmpTimer.CancelTimer(this.timer);
	this.timer = undefined;
};

//// Message handlers /////

UnitAI.prototype.OnMotionChanged = function(msg)
{
	if (msg.starting && !msg.error)
	{
		UnitFsm.ProcessMessage(this, {"type": "MoveStarted", "data": msg});
	}
	else if (!msg.starting || msg.error)
	{
		UnitFsm.ProcessMessage(this, {"type": "MoveCompleted", "data": msg});
	}
};

UnitAI.prototype.OnGlobalConstructionFinished = function(msg)
{
	// TODO: This is a bit inefficient since every unit listens to every
	// construction message - ideally we could scope it to only the one we're building

	UnitFsm.ProcessMessage(this, {"type": "ConstructionFinished", "data": msg});
};

UnitAI.prototype.OnAttacked = function(msg)
{
	UnitFsm.ProcessMessage(this, {"type": "Attacked", "data": msg});
};

UnitAI.prototype.OnRangeUpdate = function(msg)
{
	if (msg.tag == this.losRangeQuery)
		UnitFsm.ProcessMessage(this, {"type": "LosRangeUpdate", "data": msg});
};

//// Helper functions to be called by the FSM ////

UnitAI.prototype.GetWalkSpeed = function()
{
	var cmpMotion = Engine.QueryInterface(this.entity, IID_UnitMotion);
	return cmpMotion.GetWalkSpeed();
};

UnitAI.prototype.GetRunSpeed = function()
{
	var cmpMotion = Engine.QueryInterface(this.entity, IID_UnitMotion);
	return cmpMotion.GetRunSpeed();
};

/**
 * Returns true if the target exists and has non-zero hitpoints.
 */
UnitAI.prototype.TargetIsAlive = function(ent)
{
	var cmpHealth = Engine.QueryInterface(ent, IID_Health);
	if (!cmpHealth)
		return false;

	return (cmpHealth.GetHitpoints() != 0);
};

/**
 * Returns true if the target exists and needs to be killed before
 * beginning to gather resources from it.
 */
UnitAI.prototype.MustKillGatherTarget = function(ent)
{
	var cmpResourceSupply = Engine.QueryInterface(ent, IID_ResourceSupply);
	if (!cmpResourceSupply)
		return false;

	if (!cmpResourceSupply.GetKillBeforeGather())
		return false;

	return this.TargetIsAlive(ent);
};

/**
 * Play a sound appropriate to the current entity.
 */
UnitAI.prototype.PlaySound = function(name)
{
	// If we're a formation controller, use the sounds from our first member
	if (this.IsFormationController())
	{
		var cmpFormation = Engine.QueryInterface(this.entity, IID_Formation);
		var member = cmpFormation.GetPrimaryMember();
		if (member)
			PlaySound(name, member);
	}
	else
	{
		// Otherwise use our own sounds
		PlaySound(name, this.entity);
	}
};

UnitAI.prototype.SelectAnimation = function(name, once, speed, sound)
{
	var cmpVisual = Engine.QueryInterface(this.entity, IID_Visual);
	if (!cmpVisual)
		return;

	// Special case: the "move" animation gets turned into a special
	// movement mode that deals with speeds and walk/run automatically
	if (name == "move")
	{
		// Speed to switch from walking to running animations
		var runThreshold = (this.GetWalkSpeed() + this.GetRunSpeed()) / 2;

		cmpVisual.SelectMovementAnimation(runThreshold);
		return;
	}

	var soundgroup;
	if (sound)
	{
		var cmpSound = Engine.QueryInterface(this.entity, IID_Sound);
		if (cmpSound)
			soundgroup = cmpSound.GetSoundGroup(sound);
	}

	// Set default values if unspecified
	if (typeof once == "undefined")
		once = false;
	if (typeof speed == "undefined")
		speed = 1.0;
	if (typeof soundgroup == "undefined")
		soundgroup = "";

	cmpVisual.SelectAnimation(name, once, speed, soundgroup);
};

UnitAI.prototype.SetAnimationSync = function(actiontime, repeattime)
{
	var cmpVisual = Engine.QueryInterface(this.entity, IID_Visual);
	if (!cmpVisual)
		return;

	cmpVisual.SetAnimationSyncRepeat(repeattime);
	cmpVisual.SetAnimationSyncOffset(actiontime);
};

UnitAI.prototype.MoveToPoint = function(x, z)
{
	var cmpMotion = Engine.QueryInterface(this.entity, IID_UnitMotion);
	return cmpMotion.MoveToPoint(x, z);
};

UnitAI.prototype.MoveToTarget = function(target)
{
	var cmpPosition = Engine.QueryInterface(target, IID_Position);
	if (!cmpPosition)
		return false;

	if (!cmpPosition.IsInWorld())
		return false;

	var pos = cmpPosition.GetPosition();
	return this.MoveToPoint(pos.x, pos.z);
};

UnitAI.prototype.MoveToTargetRange = function(target, iid, type)
{
	var cmpRanged = Engine.QueryInterface(this.entity, iid);
	var range = cmpRanged.GetRange(type);

	var cmpMotion = Engine.QueryInterface(this.entity, IID_UnitMotion);
	return cmpMotion.MoveToAttackRange(target, range.min, range.max);
};

UnitAI.prototype.CheckTargetRange = function(target, iid, type)
{
	var cmpRanged = Engine.QueryInterface(this.entity, iid);
	var range = cmpRanged.GetRange(type);

	var cmpMotion = Engine.QueryInterface(this.entity, IID_UnitMotion);
	return cmpMotion.IsInAttackRange(target, range.min, range.max);
};

UnitAI.prototype.GetBestAttack = function()
{
	var cmpAttack = Engine.QueryInterface(this.entity, IID_Attack);
	if (!cmpAttack)
		return undefined;
	return cmpAttack.GetBestAttack();
};

/**
 * Try to find one of the given entities which can be attacked,
 * and start attacking it.
 * Returns true if it found something to attack.
 */
UnitAI.prototype.AttackVisibleEntity = function(ents)
{
	for each (var target in ents)
	{
		if (this.CanAttack(target))
		{
			this.PushOrderFront("Attack", { "target": target });
			return true;
		}
	}
	return false;
};

//// External interface functions ////

UnitAI.prototype.SetFormationController = function(ent)
{
	this.formationController = ent;

	// Set obstruction group, so we can walk through members
	// of our own formation (or ourself if not in formation)
	var cmpObstruction = Engine.QueryInterface(this.entity, IID_Obstruction);
	if (cmpObstruction)
	{
		if (ent == INVALID_ENTITY)
			cmpObstruction.SetControlGroup(this.entity);
		else
			cmpObstruction.SetControlGroup(ent);
	}

	// If we were removed from a formation, let the FSM switch back to INDIVIDUAL
	if (ent == INVALID_ENTITY)
		UnitFsm.ProcessMessage(this, { "type": "FormationLeave" });
};

UnitAI.prototype.GetFormationController = function()
{
	return this.formationController;
};

/**
 * Returns the estimated distance that this unit will travel before either
 * finishing all of its orders, or reaching a non-walk target (attack, gather, etc).
 * Intended for Formation to switch to column layout on long walks.
 */
UnitAI.prototype.ComputeWalkingDistance = function()
{
	var distance = 0;

	var cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpPosition || !cmpPosition.IsInWorld())
		return 0;

	// Keep track of the position at the start of each order
	var pos = cmpPosition.GetPosition();

	for (var i = 0; i < this.orderQueue.length; ++i)
	{
		var order = this.orderQueue[i];
		switch (order.type)
		{
		case "Walk":
			// Add the distance to the target point
			var dx = order.data.x - pos.x;
			var dz = order.data.z - pos.z;
			var d = Math.sqrt(dx*dx + dz*dz);
			distance += d;
			
			// Remember this as the start position for the next order
			pos = order.data;

			break; // and continue the loop

		case "WalkToTarget":
		case "Attack":
		case "Gather":
		case "Repair":
			// Find the target unit's position
			var cmpTargetPosition = Engine.QueryInterface(order.data.target, IID_Position);
			if (!cmpTargetPosition || !cmpTargetPosition.IsInWorld())
				return distance;
			var targetPos = cmpTargetPosition.GetPosition();

			// Add the distance to the target unit
			var dx = targetPos.x - pos.x;
			var dz = targetPos.z - pos.z;
			var d = Math.sqrt(dx*dx + dz*dz);
			distance += d;

			// Return the total distance to the target
			return distance;

		default:
			error("Unrecognised order type '"+order.type+"'");
			return distance;
		}
	}

	// Return the total distance to the end of the order queue
	return distance;
};

UnitAI.prototype.AddOrder = function(type, data, queued)
{
	if (queued)
		this.PushOrder(type, data);
	else
		this.ReplaceOrder(type, data);
};

UnitAI.prototype.Walk = function(x, z, queued)
{
	this.AddOrder("Walk", { "x": x, "z": z }, queued);
};

UnitAI.prototype.WalkToTarget = function(target, queued)
{
	this.AddOrder("WalkToTarget", { "target": target }, queued);
};

UnitAI.prototype.Attack = function(target, queued)
{
	if (!this.CanAttack(target))
	{
		this.WalkToTarget(target, queued);
		return;
	}

	this.AddOrder("Attack", { "target": target }, queued);
};

UnitAI.prototype.Garrison = function(target, queued)
{
	if (!this.CanGarrison(target))
	{
		this.WalkToTarget(target, queued);
		return;
	}
	this.AddOrder("Garrison", { "target": target }, queued);
};

UnitAI.prototype.Gather = function(target, queued)
{
	if (!this.CanGather(target))
	{
		this.WalkToTarget(target, queued);
		return;
	}

	// Save the resource type now, so if the resource gets destroyed
	// before we process the order then we still know what resource
	// type to look for more of
	var cmpResourceSupply = Engine.QueryInterface(target, IID_ResourceSupply);
	var type = cmpResourceSupply.GetType();

	this.AddOrder("Gather", { "target": target, "type": type }, queued);
};

UnitAI.prototype.Repair = function(target, queued)
{
	if (!this.CanRepair(target))
	{
		this.WalkToTarget(target, queued);
		return;
	}

	this.AddOrder("Repair", { "target": target }, queued);
};

UnitAI.prototype.SetStance = function(stance)
{
	if (g_Stances[stance])
		this.stance = stance;
	else
		error("UnitAI: Setting to invalid stance '"+stance+"'");
};

UnitAI.prototype.GetStance = function()
{
	return g_Stances[this.stance];
};

//// Helper functions ////

UnitAI.prototype.CanAttack = function(target)
{
	// Formation controllers should always respond to commands
	// (then the individual units can make up their own minds)
	if (this.IsFormationController())
		return true;

	// Verify that we're able to respond to Attack commands
	var cmpAttack = Engine.QueryInterface(this.entity, IID_Attack);
	if (!cmpAttack)
		return false;

	// TODO: verify that this is a valid target

	return true;
};

UnitAI.prototype.CanGarrison = function(target)
{
	var cmpGarrisonHolder = Engine.QueryInterface(target, IID_GarrisonHolder);
	if (!cmpGarrisonHolder)
		return false;
	
	return true;
};

UnitAI.prototype.CanGather = function(target)
{
	// Formation controllers should always respond to commands
	// (then the individual units can make up their own minds)
	if (this.IsFormationController())
		return true;

	// Verify that we're able to respond to Gather commands
	var cmpResourceGatherer = Engine.QueryInterface(this.entity, IID_ResourceGatherer);
	if (!cmpResourceGatherer)
		return false;

	// Verify that we can gather from this target
	if (!cmpResourceGatherer.GetTargetGatherRate(target))
		return false;

	// TODO: should verify it's owned by the correct player, etc

	return true;
};

UnitAI.prototype.CanRepair = function(target)
{
	// Formation controllers should always respond to commands
	// (then the individual units can make up their own minds)
	if (this.IsFormationController())
		return true;

	// Verify that we're able to respond to Repair (Builder) commands
	var cmpBuilder = Engine.QueryInterface(this.entity, IID_Builder);
	if (!cmpBuilder)
		return false;

	// TODO: verify that this is a valid target

	return true;
};


Engine.RegisterComponentType(IID_UnitAI, "UnitAI", UnitAI);
