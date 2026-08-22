import { NavLink } from "react-router-dom";

export function Nav() {
  return (
    <nav className="nav">
      <div className="mark">C</div>
      <span className="brand">Content Engine</span>
      <NavLink to="/" end>
        Inbox
      </NavLink>
      <NavLink to="/drafts">Drafts</NavLink>
      <NavLink to="/sources">Sources</NavLink>
      <NavLink to="/runs">Runs</NavLink>
      <NavLink to="/settings">Settings</NavLink>
    </nav>
  );
}
