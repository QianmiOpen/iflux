import { TRelaxProps, useRelax } from 'iflux';
import React from 'react';
import { Link } from 'react-router-dom';
import { IState } from '../store';

export default function List() {
  const { list } = useRelax<TRelaxProps<IState>>(['list']);

  return (
    <div>
      <Link to='/blog/new'>create new blog</Link>

      <br />

      {(() => {
        if (list.length === 0) {
          return <div>No blog</div>;
        }

        return list.map((v, k) => (
          <div key={v.id}>
            <Link to={`/blog/${k}`}>
              {v.id}. {v.title}
            </Link>
          </div>
        ));
      })()}
    </div>
  );
}
